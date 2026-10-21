package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"
)

func lsCmd(args []string) error {
	fs := flag.NewFlagSet("ls", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "list recursively")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New("usage: scc ls <account>:[/bucket[/prefix]] [-r]")
	}
	c, t, err := withTarget(fs.Arg(0))
	if err != nil {
		return err
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	defer w.Flush()

	if t.bucket == "" {
		names, err := c.Buckets(ctx())
		if err != nil {
			return err
		}
		for _, n := range names {
			fmt.Fprintf(w, "DIR\t%s/\n", n)
		}
		return nil
	}

	prefix := t.key
	if !*recursive && prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/" // treat "bucket/dir" as a directory, the way a file browser expects
	}
	l, err := c.List(ctx(), t.bucket, prefix, *recursive, 0)
	if err != nil {
		return err
	}
	for _, p := range l.Prefixes {
		fmt.Fprintf(w, "DIR\t%s\n", p)
	}
	for _, o := range l.Objects {
		fmt.Fprintf(w, "%s\t%s\t%s\n", humanSize(o.Size), o.LastModified.Format("2006-01-02 15:04"), o.Key)
	}
	return nil
}

// bucketsCmd lists buckets explicitly, since "acct:" resolves to the default bucket when one is set.
func bucketsCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc buckets <account>")
	}
	c, _, err := clientFor(strings.TrimSuffix(args[0], ":"))
	if err != nil {
		return err
	}
	names, err := c.Buckets(ctx())
	if err != nil {
		return err
	}
	for _, n := range names {
		fmt.Println(n)
	}
	return nil
}

func catCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc cat <account>:/bucket/key")
	}
	c, t, err := withTarget(args[0])
	if err != nil {
		return err
	}
	if t.bucket == "" || t.key == "" {
		return errors.New("cat needs a full object path")
	}
	out, err := c.Get(ctx(), t.bucket, t.key)
	if err != nil {
		return err
	}
	defer out.Body.Close()
	_, err = io.Copy(os.Stdout, out.Body)
	return err
}

func rmCmd(args []string) error {
	fs := flag.NewFlagSet("rm", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "delete everything under the prefix")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New("usage: scc rm [-r] <account>:/bucket/key")
	}
	c, t, err := withTarget(fs.Arg(0))
	if err != nil {
		return err
	}
	if t.bucket == "" || t.key == "" {
		return errors.New("rm needs a key or a prefix")
	}
	if !*recursive {
		return c.Delete(ctx(), t.bucket, t.key)
	}
	n, err := c.DeletePrefix(ctx(), t.bucket, t.key)
	if err != nil {
		return err
	}
	fmt.Printf("deleted %d object(s)\n", n)
	return nil
}

func mbCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc mb <account>:/bucket")
	}
	c, t, err := withTarget(args[0])
	if err != nil {
		return err
	}
	if t.bucket == "" {
		return errors.New("mb needs a bucket name")
	}
	return c.MkBucket(ctx(), t.bucket)
}

func rbCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc rb <account>:/bucket")
	}
	c, t, err := withTarget(args[0])
	if err != nil {
		return err
	}
	if t.bucket == "" {
		return errors.New("rb needs a bucket name")
	}
	return c.RemoveBucket(ctx(), t.bucket)
}
