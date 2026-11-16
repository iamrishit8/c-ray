<?php
require_once __DIR__ . '/../lib/Report.php';

function h($value) {
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function format_money($cents) {
    return '$' . number_format($cents / 100, 2);
}

function get_user($id) {
    $result = db_query("SELECT * FROM users WHERE id = " . intval($id));
    return mysqli_fetch_assoc($result);
}

function monthly_report($month) {
    $report = new Report($month);
    return $report->render();
}
