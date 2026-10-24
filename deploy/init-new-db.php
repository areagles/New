<?php
declare(strict_types=1);

/**
 * Points the new deployment at its own database and gives it its own secrets.
 *
 * Run on the server. The database password is never written by this script — it is left
 * empty deliberately, and set separately so it does not travel through anything but the
 * shell that sets it.
 *
 * CRON_TOKEN and APP_ENCRYPTION_KEY are generated fresh rather than copied: a new system
 * should not inherit the old one's secrets, and nothing in the new database was encrypted
 * with the old key, so there is nothing to keep compatibility with.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("cli only\n");
}

$path = '/home/u159629331/domains/areagles.com/public_html/sys/api/.env.php';
$backup = $path . '.before_new_db_' . date('Ymd_His');

if (!is_file($path)) {
    fwrite(STDERR, "ABORT: {$path} not found\n");
    exit(1);
}

$existing = include $path;
if (!is_array($existing)) {
    fwrite(STDERR, "ABORT: existing config is not an array\n");
    exit(1);
}

copy($path, $backup);
chmod($backup, 0600);

$config = [
    'DB_HOST' => $existing['DB_HOST'] ?? 'localhost',
    'DB_PORT' => $existing['DB_PORT'] ?? '3306',
    'DB_NAME' => 'u159629331_sys',
    'DB_USER' => 'u159629331_sys',
    // Set separately — see the command printed at the end.
    'DB_PASS' => '',
    // The legacy /work import is not part of a clean build.
    'WORK_DB_HOST' => '',
    'WORK_DB_PORT' => '',
    'WORK_DB_NAME' => '',
    'WORK_DB_USER' => '',
    'WORK_DB_PASS' => '',
    'CRON_TOKEN' => bin2hex(random_bytes(24)),
    'APP_ENCRYPTION_KEY' => bin2hex(random_bytes(32)),
];

file_put_contents($path, "<?php\nreturn " . var_export($config, true) . ";\n");
chmod($path, 0600);

echo "wrote {$path}\n";
echo "  DB_NAME/DB_USER : u159629331_sys\n";
echo "  DB_PASS         : empty — set it next\n";
echo "  CRON_TOKEN      : regenerated\n";
echo "  APP_ENCRYPTION_KEY: regenerated\n";
echo "  previous config : " . basename($backup) . "\n";
