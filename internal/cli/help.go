package cli

import (
	"fmt"
	"strings"
)

const transferHelp = `  -p                  match a raw S3 source prefix
  -r                  process all directory levels
  --skip-existing     keep existing destination files or objects
`

func helpCmd(args []string) error {
	if len(args) == 0 {
		fmt.Print(usageText)
		return nil
	}
	args = append([]string(nil), args...)
	switch args[0] {
	case "acct":
		args[0] = "accounts"
	case "list":
		args[0] = "ls"
	}
	if args[0] == "accounts" && len(args) == 2 {
		if args[1] == "ls" {
			args[1] = "list"
		}
		if args[1] == "remove" {
			args[1] = "rm"
		}
	}
	name := strings.Join(args, " ")
	usage, description, options, examples := "", "", "", ""
	switch name {
	case "ls":
		usage = "scc ls [-p] [-r] [-n N] <S3-path>"
		description = "List a file or directory. A trailing / explicitly selects a directory."
		options = "  -p       match a raw S3 prefix\n  -r       list all directory levels\n  -n N     entry limit (terminal: 100; piped: unlimited; 0: unlimited)\n"
		examples = "scc ls minio:/abc.txt\nscc ls -r minio:/docs\nscc ls -p -r minio:/reports/202"
	case "get":
		usage = "scc get [-p] [-r] [--skip-existing] <S3-source> [local-path]"
		description = "Download from S3. The local destination defaults to the current directory.\nFiles are saved atomically; directories copy their contents."
		options = transferHelp
		examples = "scc get minio:/abc.txt\nscc get -r minio:/docs ./out\nscc get -p -r --skip-existing minio:/reports/202 ./out"
	case "put":
		usage = "scc put [-r] [--skip-existing] <local-source> <S3-destination>"
		description = "Upload local files or directory contents to S3.\nA destination ending in / keeps the source filename. Directories require -r."
		options = "  -r                  upload directory contents recursively\n  --skip-existing     keep existing S3 objects\n"
		examples = "scc put ./abc.txt minio:/docs/\nscc put ./abc.txt minio:/renamed.txt\nscc put -r --skip-existing ./assets minio:/assets/"
	case "cp":
		usage = "scc cp [-p] [-r] [--skip-existing] <source> <destination>"
		description = "Copy between local storage and S3, or within one S3 account.\nDirectories copy their contents; -p requires an S3 source."
		options = transferHelp
		examples = "scc cp ./abc.txt minio:/docs/\nscc cp -r ./assets minio:/assets/\nscc cp --skip-existing minio:/abc.txt ./out/"
	case "rm":
		usage = "scc rm [-p] [-r] [--dry-run] <S3-path>"
		description = "Delete a file or directory. Directory paths require -r.\nUse -p for raw prefix matching. An empty prefix cannot delete a whole bucket."
		options = "  -p             match a raw S3 prefix\n  -r             include all directory levels\n  --dry-run      preview the exact objects without deleting\n"
		examples = "scc rm minio:/abc.txt\nscc rm -r --dry-run minio:/docs\nscc rm -p -r --dry-run minio:/reports/202"
	case "cat":
		usage, description = "scc cat <S3-file>", "Write an exact object's contents to stdout."
		examples = "scc cat minio:/docs/README.md"
	case "buckets":
		usage, description = "scc buckets <account>", "List buckets regardless of the account's default bucket."
		examples = "scc buckets minio"
	case "mb", "rb":
		usage = "scc " + name + " <account>://bucket"
		description = "Create a bucket."
		if name == "rb" {
			description = "Remove an empty bucket."
		}
		examples = "scc " + name + " minio://data"
	case "use":
		usage, description = "scc use <account>://bucket", "Set the account's default bucket. Use <account>: to clear it."
		examples = "scc use minio://data\nscc use minio:"
	case "web":
		usage, description = "scc web [-addr host:port]", "Start the browser UI; the default address comes from configuration."
		options, examples = "  -addr    listening address\n", "scc web -addr 127.0.0.1:8080"
	case "accounts":
		usage, description = "scc accounts <add|list|rm>", "Manage S3 accounts. Use scc help accounts add for configuration flags."
		examples = "scc accounts list\nscc help accounts add"
	case "accounts add":
		usage, description = "scc accounts add <name> [flags]", "Add or update an account. Credentials may use env:VARIABLE."
		options = "  -endpoint         S3 endpoint (omit for AWS)\n  -region           AWS region (default us-east-1)\n  -access-key       access key or env:VARIABLE (required)\n  -secret-key       secret key or env:VARIABLE (required)\n  -path-style       use path-style addressing (default for custom endpoints)\n  -default-bucket   bucket used by account-relative paths\n"
		examples = "scc accounts add minio -endpoint http://127.0.0.1:9000 -access-key env:S3_KEY -secret-key env:S3_SECRET"
	case "accounts list":
		usage, description = "scc accounts list", "List configured accounts and the configuration path; secrets are never printed."
	case "accounts rm":
		usage, description = "scc accounts rm <name>", "Remove an account from configuration."
	case "version":
		usage, description = "scc version", "Print the running binary's version."
	default:
		return fmt.Errorf("unknown help topic %q (try: scc help)", name)
	}
	fmt.Printf("usage: %s\n\n%s\n", usage, description)
	if options != "" {
		fmt.Printf("\noptions:\n%s", options)
	}
	if examples != "" {
		fmt.Printf("\nexamples:\n  %s\n", strings.ReplaceAll(examples, "\n", "\n  "))
	}
	return nil
}

func helpRequested(args []string, command string) bool {
	var values []string
	switch command {
	case "ls", "list":
		values = []string{"n"}
	case "web":
		values = []string{"addr"}
	case "accounts", "acct":
		values = []string{"endpoint", "region", "access-key", "secret-key", "default-bucket"}
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			break
		}
		if arg == "-h" || arg == "--help" {
			return true
		}
		if !strings.HasPrefix(arg, "-") || strings.Contains(arg, "=") {
			continue
		}
		for _, value := range values {
			if strings.TrimLeft(arg, "-") == value {
				i++
				break
			}
		}
	}
	return false
}
