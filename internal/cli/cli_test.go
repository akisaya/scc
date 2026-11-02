package cli

import (
	"strings"
	"testing"
)

func TestParseTarget(t *testing.T) {
	cases := []struct {
		in                string
		acct, bucket, key string
		explicit          bool
		wantErr           bool
	}{
		{in: "minio:/dir/file", acct: "minio", key: "dir/file"},
		{in: "minio:/dir/", acct: "minio", key: "dir/"},
		{in: "minio:", acct: "minio"},
		{in: "minio:/", acct: "minio"},
		{in: "minio://bucket/key", acct: "minio", bucket: "bucket", key: "key", explicit: true},
		{in: "minio://bucket/dir/a.txt", acct: "minio", bucket: "bucket", key: "dir/a.txt", explicit: true},
		{in: "minio://bucket", acct: "minio", bucket: "bucket", explicit: true},
		{in: "minio://bucket/", acct: "minio", bucket: "bucket", explicit: true},
		{in: "minio://", wantErr: true},
		{in: "/tmp/local-file", wantErr: true},
		{in: "no-colon", wantErr: true},
	}
	for _, c := range cases {
		got, err := parseTarget(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("parseTarget(%q) = %+v, want error", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseTarget(%q): %v", c.in, err)
			continue
		}
		if got.acct != c.acct || got.bucket != c.bucket || got.key != c.key ||
			got.explicit != c.explicit {
			t.Errorf("parseTarget(%q) = %+v, want {%s %s %s explicit=%t}",
				c.in, got, c.acct, c.bucket, c.key, c.explicit)
		}
	}
}

func TestIsS3(t *testing.T) {
	for in, want := range map[string]bool{
		"minio:/b/k":   true,
		"minio:":       true,
		"a:b":          true,
		"/tmp/x":       false,
		"relative.txt": false,
	} {
		if got := isS3(in); got != want {
			t.Errorf("isS3(%q) = %t, want %t", in, got, want)
		}
	}
}

func TestJoinKey(t *testing.T) {
	cases := [][3]string{
		{"", "a.txt", "a.txt"},
		{"dir", "a.txt", "dir/a.txt"},
		{"dir/", "/a.txt", "dir/a.txt"},
		{"a/b", "c/d", "a/b/c/d"},
		{"", "", ""},
	}
	for _, c := range cases {
		if got := joinKey(c[0], c[1]); got != c[2] {
			t.Errorf("joinKey(%q,%q) = %q, want %q", c[0], c[1], got, c[2])
		}
	}
}

func TestResolveTarget(t *testing.T) {
	cases := []struct {
		name       string
		in         target
		def        string
		wantBucket string
		wantKey    string
		wantErr    bool
	}{
		{"no default keeps the account root", target{}, "", "", "", false},
		{"no default rejects a relative path", target{key: "docs/a.txt"}, "", "", "", true},
		{"default takes the root", target{}, "data", "data", "", false},
		{"default resolves a relative path", target{key: "cb_test/"}, "data", "data", "cb_test/", false},
		{"default resolves a nested path", target{key: "cb_test/deep/f.txt"}, "data", "data", "cb_test/deep/f.txt", false},
		{"bucket name is never inferred", target{key: "langfuse/"}, "data", "data", "langfuse/", false},
		{"explicit form bypasses the default", target{bucket: "langfuse", key: "x/y", explicit: true}, "data", "langfuse", "x/y", false},
		{"explicit form without a default", target{bucket: "b", key: "k", explicit: true}, "", "b", "k", false},
	}
	for _, c := range cases {
		got, err := resolveTarget(c.in, c.def)
		if c.wantErr {
			if err == nil {
				t.Errorf("%s: resolveTarget(%+v, %q) = %+v, want error", c.name, c.in, c.def, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: resolveTarget(%+v, %q): %v", c.name, c.in, c.def, err)
			continue
		}
		if got.bucket != c.wantBucket || got.key != c.wantKey {
			t.Errorf("%s: resolveTarget(%+v, %q) = %+v, want bucket=%q key=%q",
				c.name, c.in, c.def, got, c.wantBucket, c.wantKey)
		}
	}
}

func TestFlagsFirst(t *testing.T) {
	cases := []struct{ in, want string }{
		{"acct:/x -n 5", "-n 5 acct:/x"},
		{"-n 5 acct:/x", "-n 5 acct:/x"},
		{"acct:/x -r", "-r acct:/x"},
		{"-r acct:/x -n 2", "-r -n 2 acct:/x"},
		{"acct:/x -n=2", "-n=2 acct:/x"},
		{"acct:/x", "acct:/x"},
		{"a b -r", "-r a b"},
	}
	for _, c := range cases {
		got := strings.Join(flagsFirst(strings.Fields(c.in), "n"), " ")
		if got != c.want {
			t.Errorf("flagsFirst(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestHumanSize(t *testing.T) {
	cases := map[int64]string{
		0: "0B", 1023: "1023B", 1024: "1.0K", 1536: "1.5K", 1048576: "1.0M", 5 << 30: "5.0G",
	}
	for in, want := range cases {
		if got := humanSize(in); got != want {
			t.Errorf("humanSize(%d) = %q, want %q", in, got, want)
		}
	}
}
