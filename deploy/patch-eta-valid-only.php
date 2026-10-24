<?php
declare(strict_types=1);

/**
 * Only a document ETA calls Valid may become a record here.
 *
 * The puller was a blacklist: skip cancelled, stage-but-do-not-import rejected, import
 * everything else. That let Invalid through, and Submitted too — a document still in flight,
 * which ETA may yet reject. Both would have become real financial records.
 *
 * Inverted to a whitelist, and the same rule added to the manual import, which checked only
 * that the staged row existed and had not been imported already — so anything staged could be
 * brought in by hand regardless of what ETA said about it.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("cli only\n");
}

$dir = '/home/u159629331/domains/areagles.com/public_html/sys/api';
$f = $dir . '/bootstrap-eta-pull.php';
$s = file_get_contents($f);

$fail = static function (string $why): void {
    fwrite(STDERR, "ABORT: {$why}\n");
    exit(1);
};

if (strpos($s, 'ae_eta_status_is_importable') !== false) {
    $fail('already patched');
}

// --- the rule, in one place both callers can use ---
$anchor = "function ae_eta_pull_documents(";
$helper = <<<'PHPCODE'
/**
 * Whether a document in this ETA status may become a record in this system.
 *
 * Only "valid" qualifies. The others are either not final — "submitted" is still in flight
 * and ETA may yet reject it — or void: "invalid" failed validation, "rejected" was refused by
 * the receiver, "cancelled" was withdrawn by the issuer. Importing any of them would create a
 * financial record for a document that does not legally exist.
 */
function ae_eta_status_is_importable(?string $status): bool
{
    return strtolower(trim((string)$status)) === 'valid';
}


PHPCODE;

if (strpos($s, $anchor) === false) {
    $fail('puller anchor not found');
}
$s = str_replace($anchor, $helper . $anchor, $s);

// --- the puller: whitelist instead of blacklist ---
$old = <<<'PHPCODE'
            $status = strtolower((string)($doc['status'] ?? ''));
            if ($status === 'cancelled') {
                // A cancelled document is void at ETA and must leave no trace here: not
                // imported, and not staged either, so it never appears in the review list
                // or gets imported by hand later. Only the count is reported back.
                $skippedCancelled++;
                continue;
            }
            if ($status === 'rejected') {
                // Rejected is the receiver refusing a document the issuer sent — still never
                // imported, but kept staged because someone usually has to look into it.
                ae_eta_stage_pulled_document($tenantId, $direction, $doc);
                $skippedRejected++;
                $pulled++;
                continue;
            }
PHPCODE;

$new = <<<'PHPCODE'
            $status = strtolower((string)($doc['status'] ?? ''));
            if ($status === 'cancelled') {
                // Withdrawn by the issuer: leaves no trace here at all, so it never appears
                // in the review list or gets imported by hand later. Only counted.
                $skippedCancelled++;
                continue;
            }
            if (!ae_eta_status_is_importable($status)) {
                // Anything not Valid is staged so it can be seen and chased, but never
                // imported — see ae_eta_status_is_importable for why each status is excluded.
                ae_eta_stage_pulled_document($tenantId, $direction, $doc);
                $skippedNotValid++;
                $pulled++;
                continue;
            }
PHPCODE;

if (strpos($s, $old) === false) {
    $fail('status branch anchor not found');
}
$s = str_replace($old, $new, $s);

// --- counters ---
$s = str_replace(
    "    \$skippedCancelled = 0;\n    \$skippedRejected = 0;\n",
    "    \$skippedCancelled = 0;\n    \$skippedNotValid = 0;\n",
    $s,
);
$s = str_replace(
    "        'skippedRejected' => \$skippedRejected,\n",
    "        'skippedNotValid' => \$skippedNotValid,\n",
    $s,
);

// --- the manual import: same rule, so a staged row cannot be brought in by hand ---
$impOld = "        throw new InvalidArgumentException('already_imported');\n";
$impNew = $impOld
    . "    }\n"
    . "    // The staged row keeps the status ETA reported. A document that is not Valid is\n"
    . "    // staged for visibility only; importing it by hand would bypass the same rule the\n"
    . "    // pull applies automatically.\n"
    . "    if (!ae_eta_status_is_importable(\$row['eta_status'] ?? null)) {\n"
    . "        throw new InvalidArgumentException('eta_document_not_valid');\n";

if (strpos($s, $impOld) === false) {
    $fail('manual import anchor not found');
}
$s = str_replace($impOld, $impNew, $s);

file_put_contents($f, $s);
echo "bootstrap-eta-pull.php patched\n";
