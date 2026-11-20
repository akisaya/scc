package cli

import (
	"errors"
	"flag"
	"io"
	"path/filepath"
)

func getCmd(args []string) error {
	fs := flag.NewFlagSet("get", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "download recursively")
	prefixMode := fs.Bool("p", false, "treat the S3 source as a raw prefix")
	skipExisting := fs.Bool("skip-existing", false, "keep existing local files")
	if err := fs.Parse(flagsFirst(args)); err != nil {
		return err
	}
	if fs.NArg() < 1 || fs.NArg() > 2 {
		return errors.New("usage: scc get [-p] [-r] [--skip-existing] <S3-source> [local-path]")
	}
	src := fs.Arg(0)
	if !isS3(src) {
		return errors.New("get requires an S3 source")
	}
	dst := "."
	if fs.NArg() == 2 {
		dst = fs.Arg(1)
	}
	// A Windows drive letter is a local volume, not an S3 account reference.
	if isS3(dst) && filepath.VolumeName(dst) == "" {
		return errors.New("get destination must be a local path")
	}
	return cpS3ToLocal(src, dst, *recursive, *prefixMode, *skipExisting)
}
