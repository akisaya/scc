package cli

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/akisaya/scc/internal/s3x"
)

func TestCPSources(t *testing.T) {
	keys := []string{
		"abc.txt", "abc.txt.bak", "abc.txt/child.txt",
		"docs/", "docs/abc.txt", "docs/sub/", "docs/sub/child.txt", "docs-old/other.txt",
	}
	for _, remote := range []bool{false, true} {
		kind := "download"
		if remote {
			kind = "S3 copy"
		}
		t.Run(kind, func(t *testing.T) {
			for _, tc := range []struct {
				name, src string
				flags     []string
				want      []string
				wantErr   string
				localErr  string
				denyHead  bool
			}{
				{name: "file", src: "abc.txt", want: []string{"abc.txt"}},
				{name: "recursive file", src: "abc.txt", flags: []string{"-r"}, want: []string{"abc.txt"}},
				{name: "directory without recursion", src: "docs", wantErr: "pass -r"},
				{name: "directory with slash without recursion", src: "docs/", wantErr: "pass -r"},
				{name: "directory", src: "docs", flags: []string{"-r"}, want: []string{"abc.txt", "sub/child.txt"}},
				{name: "directory with restricted HEAD access", src: "docs", flags: []string{"-r"}, want: []string{"abc.txt", "sub/child.txt"}, denyHead: true},
				{name: "directory with slash", src: "docs/", flags: []string{"-r"}, want: []string{"abc.txt", "sub/child.txt"}},
				{name: "same named directory", src: "abc.txt/", flags: []string{"-r"}, want: []string{"child.txt"}},
				{name: "prefix files", src: "abc", flags: []string{"-p"}, want: []string{"abc.txt", "abc.txt.bak"}},
				{name: "prefix exact file", src: "abc.txt", flags: []string{"-p"}, want: []string{"abc.txt", "abc.txt.bak"}},
				{name: "recursive prefix files", src: "abc", flags: []string{"-p", "-r"}, want: []string{"abc.txt", "abc.txt.bak", "abc.txt/child.txt"}, localErr: "file/directory conflict"},
				{name: "partial directory prefix", src: "doc", flags: []string{"-p", "-r"}, want: []string{"docs-old/other.txt", "docs/abc.txt", "docs/sub/child.txt"}},
				{name: "prefix direct children", src: "docs/", flags: []string{"-p"}, want: []string{"abc.txt"}},
				{name: "nested partial prefix", src: "docs/ab", flags: []string{"-p"}, want: []string{"abc.txt"}},
			} {
				t.Run(tc.name, func(t *testing.T) {
					mock := newS3Mock(t, keys, false)
					mock.mu.Lock()
					mock.denyHead = tc.denyHead
					mock.mu.Unlock()
					root := t.TempDir()
					t.Chdir(root)
					if err := os.Mkdir("out", 0o755); err != nil {
						t.Fatal(err)
					}
					dst := "out" // also exercise an existing relative destination directory
					if remote {
						dst = "local:/out/"
					}
					args := append([]string{"cp", "local:/" + tc.src, dst}, tc.flags...)
					_, _, err := runCLI(t, args...)
					wantErr, want := tc.wantErr, tc.want
					if !remote && tc.localErr != "" {
						wantErr, want = tc.localErr, nil
					}
					if wantErr != "" {
						if err == nil || !strings.Contains(err.Error(), wantErr) {
							t.Fatalf("error = %v, want %q", err, wantErr)
						}
					} else if err != nil {
						t.Fatal(err)
					}
					var got []string
					if remote {
						mock.mu.Lock()
						defer mock.mu.Unlock()
						for key, body := range mock.objects {
							if rel, ok := strings.CutPrefix(key, "out/"); ok {
								got = append(got, rel)
								if body != "payload" {
									t.Errorf("copied body = %q", body)
								}
							}
						}
					} else {
						err := filepath.WalkDir("out", func(p string, d fs.DirEntry, err error) error {
							if err != nil || d.IsDir() {
								return err
							}
							got = append(got, filepath.ToSlash(strings.TrimPrefix(p, "out"+string(os.PathSeparator))))
							body, err := os.ReadFile(p)
							if err == nil && string(body) != "payload" {
								t.Errorf("downloaded body = %q", body)
							}
							return err
						})
						if err != nil {
							t.Fatal(err)
						}
					}
					sort.Strings(got)
					if !reflect.DeepEqual(got, want) {
						t.Errorf("copied paths = %v, want %v", got, want)
					}
				})
			}
		})
	}
}

func TestCPPrefixRejectsLocalSource(t *testing.T) {
	_, _, err := runCLI(t, "cp", "-p", "./docs", "local:/out/")
	if err == nil || !strings.Contains(err.Error(), "requires an S3 source") {
		t.Fatalf("error = %v, want S3 source requirement", err)
	}
}

func TestCPFileWithoutListingPermission(t *testing.T) {
	for _, recursive := range []bool{false, true} {
		t.Run(fmt.Sprint(recursive), func(t *testing.T) {
			mock := newS3Mock(t, []string{"abc.txt"}, false)
			mock.mu.Lock()
			mock.denyList = true
			mock.mu.Unlock()
			dst := filepath.Join(t.TempDir(), "renamed.txt")
			args := []string{"cp", "local:/abc.txt", dst}
			if recursive {
				args = append(args, "-r")
			}
			if _, _, err := runCLI(t, args...); err != nil {
				t.Fatal(err)
			}
			body, err := os.ReadFile(dst)
			if err != nil || string(body) != "payload" {
				t.Fatalf("downloaded body = %q, error = %v", body, err)
			}
		})
	}
}

func TestDownloadTargetsRejectsConflictingPaths(t *testing.T) {
	for _, tc := range []struct {
		name string
		keys []string
		want string
	}{
		{"file and directory", []string{"docs/a", "docs/a/b"}, "file/directory conflict"},
		{"normalized duplicate", []string{"docs/a/b", "docs/a//b"}, "same local path"},
		{"parent traversal", []string{"docs/../escape"}, "cannot be mapped"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var objects []s3x.Object
			for _, key := range tc.keys {
				objects = append(objects, s3x.Object{Key: key})
			}
			_, err := downloadTargets(objects, "docs/", t.TempDir())
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}
