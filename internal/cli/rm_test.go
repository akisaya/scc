package cli

import (
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestRMSelectionAndPreview(t *testing.T) {
	keys := []string{"abc.txt", "abc.txt.bak", "abc.txt/child", "docs/", "docs/a", "docs/sub/b", "docs-old/c", "empty/"}
	for _, tc := range []struct {
		name, key string
		flags     []string
		want      []string
		wantErr   string
	}{
		{"file", "abc.txt", nil, []string{"abc.txt"}, ""},
		{"recursive file", "abc.txt", []string{"-r"}, []string{"abc.txt"}, ""},
		{"directory", "docs", []string{"-r"}, []string{"docs/", "docs/a", "docs/sub/b"}, ""},
		{"directory with slash", "docs/", []string{"-r"}, []string{"docs/", "docs/a", "docs/sub/b"}, ""},
		{"prefix direct files", "abc", []string{"-p"}, []string{"abc.txt", "abc.txt.bak"}, ""},
		{"recursive prefix", "doc", []string{"-p", "-r"}, []string{"docs-old/c", "docs/", "docs/a", "docs/sub/b"}, ""},
		{"empty directory", "empty", []string{"-r"}, []string{"empty/"}, ""},
		{"directory needs recursion", "docs", nil, nil, "pass -r"},
		{"missing", "missing", []string{"-r"}, nil, "does not exist"},
		{"bucket guard", "", []string{"-p", "-r"}, nil, "whole bucket"},
	} {
		for _, dry := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s/preview=%t", tc.name, dry), func(t *testing.T) {
				mock := newS3Mock(t, keys, false)
				args := append([]string{"rm", "local:/" + tc.key}, tc.flags...)
				if dry {
					args = append(args, "--dry-run")
				}
				out, _, err := runCLI(t, args...)
				if tc.wantErr != "" {
					if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
						t.Fatalf("error = %v", err)
					}
				} else if err != nil {
					t.Fatal(err)
				}
				mock.mu.Lock()
				defer mock.mu.Unlock()
				var got []string
				if dry {
					if len(mock.deletes) != 0 {
						t.Fatal("preview sent delete requests")
					}
					for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
						if key, ok := strings.CutPrefix(line, "would delete local://b/"); ok {
							got = append(got, key)
						}
					}
					if len(mock.objects) != len(keys) {
						t.Fatal("preview changed objects")
					}
				} else {
					for _, batch := range mock.deletes {
						got = append(got, batch...)
					}
					for _, key := range tc.want {
						if _, ok := mock.objects[key]; ok {
							t.Errorf("object %q still exists", key)
						}
					}
				}
				sort.Strings(got)
				if !reflect.DeepEqual(got, tc.want) {
					t.Errorf("selection = %v, want %v", got, tc.want)
				}
			})
		}
	}
}

func TestRMBatchesAndPartialFailure(t *testing.T) {
	var keys []string
	for i := 0; i < 1001; i++ {
		keys = append(keys, fmt.Sprintf("docs/%04d", i))
	}
	mock := newS3Mock(t, keys, false)
	if _, _, err := runCLI(t, "rm", "-r", "local:/docs"); err != nil {
		t.Fatal(err)
	}
	mock.mu.Lock()
	if len(mock.deletes) != 2 || len(mock.deletes[0]) != 1000 || len(mock.deletes[1]) != 1 {
		t.Errorf("delete batches = %v", mock.deletes)
	}
	mock.mu.Unlock()
}

func TestRMReportsPartialFailure(t *testing.T) {
	mock := newS3Mock(t, []string{"docs/a", "docs/b"}, false)
	mock.mu.Lock()
	mock.deleteFailure = "docs/b"
	mock.mu.Unlock()
	_, _, err := runCLI(t, "rm", "-r", "local:/docs")
	if err == nil || !strings.Contains(err.Error(), "deleted 1 object(s) before error") || !strings.Contains(err.Error(), "AccessDenied") {
		t.Fatalf("error = %v", err)
	}
	mock.mu.Lock()
	defer mock.mu.Unlock()
	if _, ok := mock.objects["docs/b"]; !ok {
		t.Fatal("failed object was removed")
	}
}
