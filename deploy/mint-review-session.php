<?php
declare(strict_types=1);

/**
 * Issues a session for the seeded administrator so the authenticated screens can be
 * reviewed, without a password being typed anywhere.
 *
 * This calls the same ae_create_session() the login route calls once it has verified a
 * password, so the resulting session is an ordinary one — it expires on the normal TTL and
 * shows up in the session list like any other. It exists because the review needs to see
 * what an administrator sees, not to bypass authentication as a habit: revoke it when the
 * review is done.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("cli only\n");
}

chdir('/home/u159629331/domains/areagles.com/public_html/sys/api');
require 'bootstrap.php';

$email = 'admin@areagles.com';

$stmt = ae_db()->prepare('
    SELECT u.id, u.tenant_id, u.name
    FROM ae_users u
    WHERE u.email = ? AND u.is_active = 1
    LIMIT 1
');
$stmt->execute([$email]);
$user = $stmt->fetch();

if (!$user) {
    fwrite(STDERR, "no active user {$email}\n");
    exit(1);
}

$session = ae_create_session((string)$user['id'], (string)$user['tenant_id']);

echo json_encode([
    'token' => $session['sessionToken'] ?? ($session['token'] ?? null),
    'user' => $user['name'],
    'expiresAt' => $session['expiresAt'] ?? null,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
