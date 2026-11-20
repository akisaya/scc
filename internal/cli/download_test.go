package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadPreservesExistingFileOnFailure(t *testing.T) {
	for _, chunked := range []bool{false, true} {
		t.Run(fmt.Sprint(chunked), func(t *testing.T) {
			mock := newS3Mock(t, []string{"a.txt"}, false)
			mock.mu.Lock()
			if chunked {
				mock.shortChunkedGet = "a.txt"
			} else {
				mock.shortGet = "a.txt"
			}
			mock.mu.Unlock()
			dir := t.TempDir()
			dst := filepath.Join(dir, "a.txt")
			if err := os.WriteFile(dst, []byte("original"), 0o640); err != nil {
				t.Fatal(err)
			}
			_, _, err := runCLI(t, "get", "local:/a.txt", dst)
			if err == nil {
				t.Fatal("expected interrupted transfer error")
			}
			body, err := os.ReadFile(dst)
			if err != nil || string(body) != "original" {
				t.Fatalf("target = %q, error = %v", body, err)
			}
			parts, err := filepath.Glob(filepath.Join(dir, ".scc-download-*.part"))
			if err != nil || len(parts) != 0 {
				t.Fatalf("temporary files = %v, error = %v", parts, err)
			}
		})
	}
}

func TestTransferSkipExisting(t *testing.T) {
	for _, command := range []string{"get", "cp"} {
		t.Run(command, func(t *testing.T) {
			mock := newS3Mock(t, []string{"docs/a", "docs/b"}, false)
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "a"), []byte("original"), 0o640); err != nil {
				t.Fatal(err)
			}
			out, stderr, err := runCLI(t, command, "local:/docs", dir, "-r", "--skip-existing")
			if err != nil {
				t.Fatal(err)
			}
			body, _ := os.ReadFile(filepath.Join(dir, "a"))
			if string(body) != "original" {
				t.Fatalf("existing file changed: %q", body)
			}
			body, _ = os.ReadFile(filepath.Join(dir, "b"))
			if string(body) != "payload" {
				t.Fatalf("missing download: %q", body)
			}
			if !strings.Contains(stderr, "downloaded 1 file(s), 7B; skipped 1") {
				t.Fatalf("summary = %q", stderr)
			}
			if strings.Contains(out+stderr, "\033[") {
				t.Fatal("non-terminal output contains dynamic progress")
			}
			mock.mu.Lock()
			defer mock.mu.Unlock()
			if len(mock.gets) != 1 || mock.gets[0] != "docs/b" {
				t.Fatalf("GET requests = %v", mock.gets)
			}
		})
	}
}

func TestSkipExistingRemoteDestinations(t *testing.T) {
	for _, upload := range []bool{false, true} {
		t.Run(map[bool]string{false: "copy", true: "upload"}[upload], func(t *testing.T) {
			mock := newS3Mock(t, []string{"a", "out/a"}, false)
			src := "local:/a"
			if upload {
				src = filepath.Join(t.TempDir(), "a")
				if err := os.WriteFile(src, []byte("new"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			_, summary, err := runCLI(t, "cp", src, "local:/out/", "--skip-existing")
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(summary, "skipped 1") {
				t.Fatal(summary)
			}
			mock.mu.Lock()
			defer mock.mu.Unlock()
			if len(mock.writes) != 0 {
				t.Fatalf("skip wrote objects: %v", mock.writes)
			}
		})
	}
}

func TestSuccessfulDownloadReplacesFile(t *testing.T) {
	newS3Mock(t, []string{"a"}, false)
	dst := filepath.Join(t.TempDir(), "a")
	if err := os.WriteFile(dst, []byte("original"), 0o640); err != nil {
		t.Fatal(err)
	}
	if _, _, err := runCLI(t, "get", "local:/a", dst); err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(dst)
	if string(body) != "payload" {
		t.Fatalf("body = %q", body)
	}
	fi, err := os.Stat(dst)
	if err != nil || fi.Mode().Perm() != 0o640 {
		t.Fatalf("permissions not preserved: %v, %v", fi, err)
	}
}
