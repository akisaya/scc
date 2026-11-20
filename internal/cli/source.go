package cli

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/akisaya/scc/internal/s3x"
)

// source selects either an exact object or a prefix to list. In path mode a
// trailing slash selects a directory; otherwise an exact object takes priority.
type source struct {
	prefix string
	object *s3x.Object
}

func resolveSource(key string, prefixMode bool, lookup func() (s3x.Object, error)) (source, error) {
	if prefixMode || key == "" || strings.HasSuffix(key, "/") {
		return source{prefix: key}, nil
	}
	object, err := lookup()
	if err != nil && !s3x.IsNotFound(err) {
		return source{}, err
	}
	if err == nil && object.Key == key {
		return source{prefix: parentPrefix(key), object: &object}, nil
	}
	return source{prefix: key + "/"}, nil
}

// listedObject probes a key without requiring permission to read its contents.
func listedObject(ctx context.Context, c *s3x.Client, bucket, key string) (s3x.Object, error) {
	// S3 lists keys in order, so an exact key is the first prefix match.
	probe, err := c.ListPage(ctx, bucket, key, false, 1, "")
	if err != nil {
		return s3x.Object{}, err
	}
	if len(probe.Objects) > 0 && probe.Objects[0].Key == key {
		return probe.Objects[0], nil
	}
	return s3x.Object{}, nil
}

func copyObject(ctx context.Context, c *s3x.Client, bucket, key string) (s3x.Object, error) {
	object, err := c.Stat(ctx, bucket, key)
	// A policy can allow listing and reading children while denying HEAD on the
	// directory's unsuffixed key. Fall back to listing to resolve that path.
	var responseErr interface{ HTTPStatusCode() int }
	if errors.As(err, &responseErr) && responseErr.HTTPStatusCode() == http.StatusForbidden {
		return listedObject(ctx, c, bucket, key)
	}
	return object, err
}

// parentPrefix keeps the directory portion without cleaning or rewriting S3 keys.
func parentPrefix(key string) string {
	return key[:strings.LastIndexByte(key, '/')+1]
}

func listSource(ctx context.Context, c *s3x.Client, bucket, name string, selected source, recursive, prefixMode bool, limit int32) (*s3x.Listing, error) {
	l, err := c.List(ctx, bucket, selected.prefix, recursive, limit)
	if err != nil {
		return nil, err
	}
	if !prefixMode && selected.prefix != "" && !l.HasMatches {
		return nil, fmt.Errorf("path %q does not exist", name)
	}
	return l, nil
}

func noMatchingFiles(name string, l *s3x.Listing) {
	if len(l.Prefixes) > 0 {
		fmt.Fprintf(os.Stderr, "prefix %q matches only directories; use -r to include their files\n", name)
	} else if l.FolderMarker != nil {
		fmt.Fprintf(os.Stderr, "empty directory: %s\n", name)
	} else if l.HasMatches {
		fmt.Fprintf(os.Stderr, "prefix %q matches only folder placeholders; no files to transfer\n", name)
	} else {
		fmt.Fprintf(os.Stderr, "no objects match prefix %q\n", name)
	}
}
