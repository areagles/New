#!/usr/bin/env bash
# Sets DB_PASS in the new deployment's config.
#
# Prompts with the input hidden and writes it straight into the file, so the password does
# not appear on the command line, in shell history, or anywhere it could be read back.
set -euo pipefail

ENV_FILE=~/domains/areagles.com/public_html/sys/api/.env.php
[ -f "$ENV_FILE" ] || { echo "config not found: $ENV_FILE" >&2; exit 1; }

printf 'Password for database u159629331_sys: '
read -rs DB_PASS
printf '\n'
[ -n "$DB_PASS" ] || { echo "nothing entered" >&2; exit 1; }

DB_PASS="$DB_PASS" php -r '
$path = getenv("HOME") . "/domains/areagles.com/public_html/sys/api/.env.php";
$config = include $path;
$config["DB_PASS"] = getenv("DB_PASS");
file_put_contents($path, "<?php\nreturn " . var_export($config, true) . ";\n");
chmod($path, 0600);
echo "  password stored\n";
'
unset DB_PASS

php -r '
$path = getenv("HOME") . "/domains/areagles.com/public_html/sys/api/.env.php";
$c = include $path;
try {
    new PDO(
        sprintf("mysql:host=%s;dbname=%s;charset=utf8mb4", $c["DB_HOST"], $c["DB_NAME"]),
        $c["DB_USER"],
        $c["DB_PASS"],
    );
    echo "  connection to " . $c["DB_NAME"] . ": OK\n";
} catch (Throwable $e) {
    echo "  connection FAILED: " . substr($e->getMessage(), 0, 140) . "\n";
    exit(1);
}
'
