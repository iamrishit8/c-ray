<?php
require_once __DIR__ . '/../includes/functions.php';

class Report {
    private $month;

    public function __construct($month) {
        $this->month = $month;
    }

    public function totals() {
        $result = db_query("SELECT SUM(total_cents) AS total FROM orders WHERE MONTH(created_at) = " . intval($this->month));
        $row = mysqli_fetch_assoc($result);
        return $row['total'];
    }

    public function render() {
        return 'Total for month ' . $this->month . ': ' . format_money($this->totals());
    }
}
