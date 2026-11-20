package cli

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestPutUploads(t *testing.T) {
	for _, tc := range []struct {
		name, destination string
		directory         bool
		flags             []string
		existing, want    map[string]string
		wantErr, summary  string
	}{
		{name: "file into directory", destination: "local:/docs/", want: map[string]string{"docs/a.txt": "alpha"}},
		{name: "renamed file", destination: "local:/renamed.txt", want: map[string]string{"renamed.txt": "alpha"}},
		{name: "explicit bucket", destination: "local://b/docs/", want: map[string]string{"docs/a.txt": "alpha"}},
		{name: "bucket root", destination: "local://b", want: map[string]string{"a.txt": "alpha"}},
		{name: "recursive file", destination: "local:/docs/", flags: []string{"-r"}, want: map[string]string{"docs/a.txt": "alpha"}},
		{name: "directory contents", destination: "local:/docs", directory: true, flags: []string{"-r"}, want: map[string]string{"docs/a.txt": "alpha", "docs/sub/b.txt": "beta"}},
		{name: "directory needs recursion", destination: "local:/docs", directory: true, want: map[string]string{}, wantErr: "pass -r"},
		{name: "skip file", destination: "local:/docs/", flags: []string{"--skip-existing"}, existing: map[string]string{"docs/a.txt": "original"}, want: map[string]string{"docs/a.txt": "original"}, summary: "uploaded 0 file(s), 0B; skipped 1"},
		{name: "skip in directory", destination: "local:/docs", directory: true, flags: []string{"-r", "--skip-existing"}, existing: map[string]string{"docs/a.txt": "original"}, want: map[string]string{"docs/a.txt": "original", "docs/sub/b.txt": "beta"}, summary: "uploaded 1 file(s), 4B; skipped 1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mock := newS3Mock(t, nil, false)
			mock.mu.Lock()
			for key, body := range tc.existing {
				mock.objects[key] = body
			}
			mock.mu.Unlock()
			dir := t.TempDir()
			if err := os.Mkdir(filepath.Join(dir, "sub"), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("alpha"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "sub", "b.txt"), []byte("beta"), 0o600); err != nil {
				t.Fatal(err)
			}
			src := filepath.Join(dir, "a.txt")
			if tc.directory {
				src = dir
			}
			args := append([]string{"put", src, tc.destination}, tc.flags...)
			_, summary, err := runCLI(t, args...)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("error = %v, want %q", err, tc.wantErr)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			if tc.summary != "" && !strings.Contains(summary, tc.summary) {
				t.Fatalf("summary = %q, want %q", summary, tc.summary)
			}
			mock.mu.Lock()
			defer mock.mu.Unlock()
			if !reflect.DeepEqual(mock.objects, tc.want) {
				t.Errorf("uploaded objects = %v, want %v", mock.objects, tc.want)
			}
			for _, key := range mock.writes {
				if _, exists := tc.existing[key]; exists {
					t.Errorf("skip-existing wrote %q", key)
				}
			}
		})
	}
}

func TestPutInvalidArguments(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{"no arguments", []string{"put"}, "usage: scc put"},
		{"no destination", []string{"put", "./a.txt"}, "usage: scc put"},
		{"extra arguments", []string{"put", "./a.txt", "local:/a.txt", "extra"}, "usage: scc put"},
		{"S3 source", []string{"put", "local:/a.txt", "local:/out/"}, "source must be a local path"},
		{"local destination", []string{"put", "./a.txt", "./out/"}, "requires an S3 destination"},
		{"prefix flag", []string{"put", "-p", "./a.txt", "local:/out/"}, "flag provided but not defined"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := runCLI(t, tc.args...)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}
