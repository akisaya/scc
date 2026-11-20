package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSourceFeedback(t *testing.T) {
	for _, command := range []string{"ls", "get", "cp", "rm"} {
		for _, prefix := range []bool{false, true} {
			name := command
			if prefix {
				name += "/prefix"
			}
			t.Run(name, func(t *testing.T) {
				mock := newS3Mock(t, nil, false)
				args := []string{command, "local:/missing"}
				if command == "get" || command == "cp" {
					args = append(args, filepath.Join(t.TempDir(), "out"))
				}
				if prefix {
					args = append(args, "-p")
				}
				_, stderr, err := runCLI(t, args...)
				if prefix {
					if err != nil || !strings.Contains(stderr, "no objects match prefix") {
						t.Fatalf("feedback = %q, %v", stderr, err)
					}
				} else if err == nil || !strings.Contains(err.Error(), "does not exist") {
					t.Fatalf("error = %v", err)
				}
				mock.mu.Lock()
				defer mock.mu.Unlock()
				if len(mock.gets)+len(mock.writes)+len(mock.deletes) != 0 {
					t.Fatal("empty selection transferred or deleted data")
				}
			})
		}
	}
}

func TestEmptyFolderPlaceholder(t *testing.T) {
	for _, command := range []string{"ls", "get"} {
		t.Run(command, func(t *testing.T) {
			newS3Mock(t, []string{"empty/"}, false)
			args := []string{command, "local:/empty"}
			if command == "get" {
				args = append(args, filepath.Join(t.TempDir(), "out"), "-r")
			}
			out, stderr, err := runCLI(t, args...)
			if err != nil || out != "" {
				t.Fatalf("empty folder = %q, %v", out, err)
			}
			want := "empty directory"
			if command == "get" {
				want = "downloaded 0 file(s), 0B"
			}
			if !strings.Contains(stderr, want) {
				t.Fatalf("feedback = %q, want %q", stderr, want)
			}
		})
	}
}

func TestPrefixEmptyFolderFeedback(t *testing.T) {
	newS3Mock(t, []string{"empty/"}, false)
	_, stderr, err := runCLI(t, "get", "-p", "local:/empty/", filepath.Join(t.TempDir(), "out"))
	if err != nil || !strings.Contains(stderr, "empty directory") || strings.Contains(stderr, "no objects match") {
		t.Fatalf("empty prefix = %q, %v", stderr, err)
	}
}

func TestUploadProgressAndSummary(t *testing.T) {
	mock := newS3Mock(t, nil, false)
	src := filepath.Join(t.TempDir(), "a")
	if err := os.WriteFile(src, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, stderr, err := runCLI(t, "cp", src, "local:/a")
	if err != nil || !strings.Contains(stderr, "uploaded 1 file(s), 7B; skipped 0") {
		t.Fatalf("upload = %q, %v", stderr, err)
	}
	mock.mu.Lock()
	defer mock.mu.Unlock()
	if mock.objects["a"] != "payload" {
		t.Fatalf("uploaded body = %q", mock.objects["a"])
	}
}
