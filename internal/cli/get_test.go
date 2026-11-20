package cli

import (
	"os"
	"strings"
	"testing"
)

func TestGetDefaultDestination(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want []string
	}{
		{"file", []string{"get", "local:/docs/abc.txt"}, []string{"abc.txt"}},
		{"explicit bucket", []string{"get", "local://b/docs/abc.txt"}, []string{"abc.txt"}},
		{"directory", []string{"get", "local:/docs", "-r"}, []string{"abc.txt", "sub/child.txt"}},
		{"prefix", []string{"get", "-p", "-r", "local:/doc"}, []string{"docs/abc.txt", "docs/sub/child.txt", "docs-old/other.txt"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			newS3Mock(t, []string{"docs/abc.txt", "docs/sub/child.txt", "docs-old/other.txt"}, false)
			t.Chdir(t.TempDir())
			if _, _, err := runCLI(t, tc.args...); err != nil {
				t.Fatal(err)
			}
			for _, p := range tc.want {
				body, err := os.ReadFile(p)
				if err != nil || string(body) != "payload" {
					t.Errorf("download %q = %q, error = %v", p, body, err)
				}
			}
		})
	}
}

func TestGetInvalidArguments(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{"no source", []string{"get"}, "usage: scc get"},
		{"extra arguments", []string{"get", "local:/a.txt", "./out", "extra"}, "usage: scc get"},
		{"local source", []string{"get", "./a.txt", "./out"}, "requires an S3 source"},
		{"S3 destination", []string{"get", "local:/a.txt", "local:/out/"}, "destination must be a local path"},
		{"unknown flag", []string{"get", "local:/a.txt", "-n", "1"}, "flag provided but not defined"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := runCLI(t, tc.args...)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}
