package cli

import "testing"

func TestParseTarget(t *testing.T) {
	cases := []struct {
		in                string
		acct, bucket, key string
		dir               bool
		wantErr           bool
	}{
		{in: "minio:/bucket/key", acct: "minio", bucket: "bucket", key: "key"},
		{in: "minio:/bucket/dir/a.txt", acct: "minio", bucket: "bucket", key: "dir/a.txt"},
		{in: "minio:/bucket", acct: "minio", bucket: "bucket"},
		{in: "minio:/bucket/", acct: "minio", bucket: "bucket", dir: true},
		{in: "minio:/dir/", acct: "minio", bucket: "dir", dir: true},
		{in: "minio:", acct: "minio"},
		{in: "minio:/", acct: "minio"},
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
		if got.acct != c.acct || got.bucket != c.bucket || got.key != c.key || got.dir != c.dir {
			t.Errorf("parseTarget(%q) = %+v, want {%s %s %s dir=%t}", c.in, got, c.acct, c.bucket, c.key, c.dir)
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
	buckets := map[string]bool{"langfuse": true}
	exists := func(n string) bool { return buckets[n] }

	cases := []struct {
		name       string
		in         target
		def        string
		wantBucket string
		wantKey    string
	}{
		{"no default, explicit bucket", target{bucket: "b", key: "k"}, "", "b", "k"},
		{"no default, no bucket", target{}, "", "", ""},
		{"empty path takes default", target{}, "data", "data", ""},
		{"default bucket named explicitly", target{bucket: "data", key: "k"}, "data", "data", "k"},
		{"real bucket wins", target{bucket: "langfuse", key: "x/y"}, "data", "langfuse", "x/y"},
		{"folder in default bucket", target{bucket: "cb_test", key: "deep/file.txt"}, "data", "data", "cb_test/deep/file.txt"},
		{"folder keeps its slash", target{bucket: "cb_test", dir: true}, "data", "data", "cb_test/"},
		{"root file has no slash", target{bucket: "test_abc"}, "data", "data", "test_abc"},
		{"folder without slash", target{bucket: "cb_test"}, "data", "data", "cb_test"},
	}
	for _, c := range cases {
		got := resolveTarget(c.in, c.def, exists)
		if got.bucket != c.wantBucket || got.key != c.wantKey {
			t.Errorf("%s: resolveTarget(%+v, %q) = %+v, want bucket=%q key=%q",
				c.name, c.in, c.def, got, c.wantBucket, c.wantKey)
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
