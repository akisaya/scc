package cli

import (
	"strings"
	"testing"
)

func TestLSFilesAndDirectories(t *testing.T) {
	keys := []string{
		"abc.txt", "abc.txt.bak", "abc.txt/child.txt", "README",
		"docs/", "docs/abc.txt", "docs/abc.txt.bak", "docs/sub/child.txt",
		"reports/cache/a.txt", "reports/cache-old/b.txt",
	}
	for _, tc := range []struct {
		name    string
		args    []string
		want    string
		warning bool
		denied  bool
		query   *listRequest
		wantErr string
		message string
	}{
		{name: "root file", args: []string{"local:/abc.txt"}, want: "abc.txt"},
		{name: "nested file", args: []string{"local:/docs/abc.txt"}, want: "abc.txt"},
		{name: "file without extension", args: []string{"local:/README"}, want: "README"},
		{name: "explicit bucket", args: []string{"local://b/docs/abc.txt"}, want: "abc.txt"},
		{name: "exact file with limit", args: []string{"local:/abc.txt", "-n", "1"}, want: "abc.txt"},
		{name: "directory without slash", args: []string{"local:/docs"}, want: "DIR sub/\nabc.txt\nabc.txt.bak"},
		{name: "directory with slash", args: []string{"local:/docs/"}, want: "DIR sub/\nabc.txt\nabc.txt.bak"},
		{name: "same named directory", args: []string{"local:/abc.txt/"}, want: "child.txt"},
		{name: "directory boundary", args: []string{"local:/reports/cache"}, want: "a.txt"},
		{name: "partial directory name", args: []string{"local:/reports/cac"}, wantErr: "does not exist"},
		{name: "missing file", args: []string{"local:/missing.txt"}, wantErr: "does not exist"},
		{name: "recursive exact file", args: []string{"local:/abc.txt", "-r"}, want: "abc.txt"},
		{name: "recursive nested file", args: []string{"local:/docs/abc.txt", "-r"}, want: "docs/abc.txt"},
		{name: "recursive directory without slash", args: []string{"local:/reports/cache", "-r"}, want: "reports/cache/a.txt", query: &listRequest{"reports/cache/", ""}},
		{name: "recursive same named directory", args: []string{"local:/abc.txt/", "-r"}, want: "abc.txt/child.txt"},
		{name: "prefix exact filename", args: []string{"local:/abc.txt", "-p"}, want: "DIR abc.txt/\nabc.txt\nabc.txt.bak", query: &listRequest{"abc.txt", "/"}},
		{name: "prefix partial filename", args: []string{"local:/docs/abc", "-p"}, want: "abc.txt\nabc.txt.bak", query: &listRequest{"docs/abc", "/"}},
		{name: "prefix partial directory", args: []string{"local:/reports/cac", "-p"}, want: "DIR cache-old/\nDIR cache/", query: &listRequest{"reports/cac", "/"}},
		{name: "prefix directory with slash", args: []string{"local:/docs/", "-p"}, want: "DIR sub/\nabc.txt\nabc.txt.bak"},
		{name: "recursive prefix", args: []string{"local:/abc.txt", "-p", "-r"}, want: "abc.txt\nabc.txt.bak\nabc.txt/child.txt", query: &listRequest{"abc.txt", ""}},
		{name: "recursive partial prefix", args: []string{"local:/reports/cac", "-p", "-r"}, want: "reports/cache-old/b.txt\nreports/cache/a.txt"},
		{name: "prefix missing", args: []string{"local:/missing", "-p"}, message: "no objects match prefix"},
		{name: "bucket root", args: []string{"local:"}, want: "DIR abc.txt/\nDIR docs/\nDIR reports/\nREADME\nabc.txt\nabc.txt.bak"},
		{name: "capped directory", args: []string{"local:/docs", "-n", "2"}, want: "abc.txt", warning: true},
		{name: "capped prefix", args: []string{"local:/abc.txt", "-p", "-n", "2"}, want: "abc.txt\nabc.txt.bak", warning: true},
		{name: "unlimited directory", args: []string{"local:/docs", "-n", "0"}, want: "DIR sub/\nabc.txt\nabc.txt.bak"},
		{name: "listing error", args: []string{"local:/abc.txt"}, denied: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mock := newS3Mock(t, keys, tc.denied)
			out, errOut, err := runCLI(t, append([]string{"ls"}, tc.args...)...)
			if tc.denied {
				if err == nil || !strings.Contains(err.Error(), "AccessDenied") {
					t.Fatalf("got error %v, want AccessDenied", err)
				}
			} else if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("error = %v, want %q", err, tc.wantErr)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			var got []string
			for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				if rest, ok := strings.CutPrefix(line, "DIR"); ok {
					got = append(got, "DIR "+strings.TrimSpace(rest))
				} else {
					metadata := "7B 2026-01-01 00:00 "
					line = strings.Join(strings.Fields(line), " ")
					if !strings.HasPrefix(line, metadata) {
						t.Errorf("unexpected object metadata: %q", line)
					}
					got = append(got, strings.TrimPrefix(line, metadata))
				}
			}
			if strings.Join(got, "\n") != tc.want {
				t.Errorf("ls output = %q, want %q", strings.Join(got, "\n"), tc.want)
			}
			if tc.warning {
				if !strings.Contains(string(errOut), "只显示了前 2 项") {
					t.Errorf("missing truncation warning: %q", errOut)
				}
			} else if tc.message != "" {
				if !strings.Contains(errOut, tc.message) {
					t.Errorf("stderr = %q, want %q", errOut, tc.message)
				}
			} else if len(errOut) != 0 {
				t.Errorf("unexpected stderr: %q", errOut)
			}
			if tc.query != nil {
				mock.mu.Lock()
				defer mock.mu.Unlock()
				if n := len(mock.requests); n == 0 || mock.requests[n-1] != *tc.query {
					t.Errorf("S3 queries = %v, want final query %v", mock.requests, *tc.query)
				}
				if strings.Contains(strings.Join(tc.args, " "), "-p") && len(mock.requests) != 1 {
					t.Errorf("prefix mode made %d listing requests, want 1", len(mock.requests))
				}
			}
		})
	}
}
