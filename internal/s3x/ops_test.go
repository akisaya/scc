package s3x

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"scc/internal/config"
)

// listServer answers ListObjectsV2 with one page of keys per call, truncated while
// pages remain, so both the capped and the paginated paths can be exercised.
func listServer(t *testing.T, keys []string) *httptest.Server {
	t.Helper()
	var call atomic.Int32
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("list-type") != "2" {
			t.Errorf("unexpected request %s", r.URL)
		}
		n := int(call.Add(1))
		page, total := keys[:1], len(keys)
		if n > 1 {
			page = keys[1:]
		}
		truncated := "true"
		if n > 1 || len(keys) == 1 {
			truncated = "false"
		}
		w.Header().Set("Content-Type", "application/xml")
		fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<Name>b</Name><Prefix></Prefix><KeyCount>%d</KeyCount><MaxKeys>1000</MaxKeys>
<IsTruncated>%s</IsTruncated>`, total, truncated)
		for _, k := range page {
			fmt.Fprintf(w, `<Contents><Key>%s</Key><Size>1</Size>
<LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>"e"</ETag></Contents>`, k)
		}
		if truncated == "true" {
			io.WriteString(w, `<NextContinuationToken>tok</NextContinuationToken>`)
		}
		io.WriteString(w, `</ListBucketResult>`)
	}))
}

func TestListCappedStopsAtOnePage(t *testing.T) {
	srv := listServer(t, []string{"a.txt", "b.txt", "c.txt"})
	defer srv.Close()

	c, err := Open(config.Account{Name: "t", Endpoint: srv.URL, AccessKey: "k", SecretKey: "s", PathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.List(context.Background(), "b", "", false, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Objects) != 1 || !got.Truncated {
		t.Fatalf("capped list = %d objects, truncated=%t; want 1, true", len(got.Objects), got.Truncated)
	}
}

func TestListUncappedFollowsPages(t *testing.T) {
	srv := listServer(t, []string{"a.txt", "b.txt", "c.txt"})
	defer srv.Close()

	c, err := Open(config.Account{Name: "t", Endpoint: srv.URL, AccessKey: "k", SecretKey: "s", PathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.List(context.Background(), "b", "", true, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Objects) != 3 || got.Truncated {
		t.Fatalf("uncapped list = %d objects, truncated=%t; want 3, false", len(got.Objects), got.Truncated)
	}
}

// A key that equals the listed prefix is a real object, not the zero-byte "dir/"
// placeholder, and must not be dropped.
func TestListKeepsObjectEqualToPrefix(t *testing.T) {
	serve := func(key string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/xml")
			fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<Name>b</Name><Prefix>%s</Prefix><KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys>
<IsTruncated>false</IsTruncated>
<Contents><Key>%s</Key><Size>7</Size>
<LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>"e"</ETag></Contents>
</ListBucketResult>`, r.URL.Query().Get("prefix"), key)
		}))
	}

	for _, tc := range []struct {
		prefix  string
		key     string
		wantLen int
	}{
		{"README", "README", 1}, // exact file name as prefix
		{"docs/", "docs/", 0},   // a real folder placeholder is still skipped
		{"docs/a.txt", "docs/a.txt", 1},
	} {
		srv := serve(tc.key)
		c, err := Open(config.Account{Name: "t", Endpoint: srv.URL, AccessKey: "k", SecretKey: "s", PathStyle: true})
		if err != nil {
			t.Fatal(err)
		}
		got, err := c.List(context.Background(), "b", tc.prefix, false, 0)
		srv.Close()
		if err != nil {
			t.Fatalf("prefix %q: %v", tc.prefix, err)
		}
		if len(got.Objects) != tc.wantLen {
			t.Errorf("prefix %q, key %q: got %d objects, want %d", tc.prefix, tc.key, len(got.Objects), tc.wantLen)
		}
	}
}
