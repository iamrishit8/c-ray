<?php
require_once '../includes/db.php';
require_once '../includes/functions.php';
require_once '../lib/Mailer.php';

// FIXME no authentication on this endpoint!
header('Content-Type: text/csv');

$result = db_query('SELECT id, email, total_cents FROM orders');
$lines = array();
while ($row = mysqli_fetch_assoc($result)) {
    $lines[] = $row['id'] . ',' . $row['email'] . ',' . format_money($row['total_cents']);
}
$csv = implode("\n", $lines);
echo $csv;

if (isset($_GET['mail'])) {
    $mailer = new Mailer();
    $mailer->send($_GET['mail'], 'Export', $csv);
}
