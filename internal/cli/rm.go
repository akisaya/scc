package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/akisaya/scc/internal/s3x"
)

func rmCmd(args []string) error {
	fs := flag.NewFlagSet("rm", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "delete directory contents recursively")
	prefixMode := fs.Bool("p", false, "treat the path as a raw S3 prefix")
	dryRun := fs.Bool("dry-run", false, "show selected objects without deleting")
	if err := fs.Parse(flagsFirst(args)); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New("usage: scc rm [-p] [-r] [--dry-run] <S3-path>")
	}
	c, t, err := withTarget(fs.Arg(0))
	if err != nil {
		return err
	}
	if t.bucket == "" || t.key == "" {
		return errors.New("rm needs a file, directory or non-empty prefix; refusing to delete a whole bucket")
	}
	selected, err := resolveSource(t.key, *prefixMode, func() (s3x.Object, error) {
		return listedObject(ctx(), c, t.bucket, t.key)
	})
	if err != nil {
		return err
	}
	var objects []s3x.Object
	if selected.object != nil {
		objects = []s3x.Object{*selected.object}
	} else {
		limit := int32(0)
		if !*prefixMode && !*recursive {
			limit = 1
		}
		l, err := listSource(ctx(), c, t.bucket, fs.Arg(0), selected, *recursive, *prefixMode, limit)
		if err != nil {
			return err
		}
		if !*prefixMode && !*recursive {
			return fmt.Errorf("%q is a directory; pass -r to delete its contents", fs.Arg(0))
		}
		objects = l.Objects
		if l.FolderMarker != nil {
			objects = append(objects, *l.FolderMarker)
		}
		if len(objects) == 0 && *prefixMode {
			noMatchingFiles(fs.Arg(0), l)
		}
	}
	keys := make([]string, 0, len(objects))
	var size int64
	for _, object := range objects {
		keys = append(keys, object.Key)
		size += object.Size
		if *dryRun {
			fmt.Printf("would delete %s://%s/%s\n", t.acct, t.bucket, object.Key)
		}
	}
	if *dryRun {
		fmt.Fprintf(os.Stderr, "dry run: %d object(s), %s; nothing deleted\n", len(keys), humanSize(size))
		return nil
	}
	n, err := c.DeleteKeys(ctx(), t.bucket, keys)
	if err != nil {
		return fmt.Errorf("deleted %d object(s) before error: %w", n, err)
	}
	fmt.Printf("deleted %d object(s)\n", n)
	return nil
}
