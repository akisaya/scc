package main

import (
	"fmt"
	"os"

	"scc/internal/cli"
	"scc/internal/s3x"
)

// version is stamped by the release workflow (-X main.version=v1.2.3).
var version = "dev"

func main() {
	if len(os.Args) == 2 && (os.Args[1] == "--version" || os.Args[1] == "version") {
		fmt.Println("scc", version)
		return
	}
	if err := cli.Run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "scc:", err)
		if h := s3x.Hint(err); h != "" {
			fmt.Fprintln(os.Stderr, "hint:", h)
		}
		os.Exit(1)
	}
}
