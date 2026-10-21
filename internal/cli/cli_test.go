package cli

import "testing"

func TestParseTarget(t *testing.T) {
	cases := []struct {
		in                string
		acct, bucket, key string
		wantErr           bool
	}{
		{in: "minio:/bucket/key", acct: "minio", bucket: "bucket", key: "key"},
		{in: "minio:/bucket/dir/a.txt", acct: "minio", bucket: "bucket", key: "dir/a.txt"},
		{in: "minio:/bucket", acct: "minio", bucket: "bucket"},
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
		if got.acct != c.acct || got.bucket != c.bucket || got.key != c.key {
			t.Errorf("parseTarget(%q) = %+v, want {%s %s %s}", c.in, got, c.acct, c.bucket, c.key)
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
