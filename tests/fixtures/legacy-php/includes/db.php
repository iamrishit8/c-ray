<?php
// XXX credentials should not live here
$db_host = 'localhost';
$db_user = 'root';
$db_password = 'hunter2-prod-db-Pa55word';
$db_name = 'legacy_shop';

$conn = mysqli_connect($db_host, $db_user, $db_password, $db_name);

function db_query($sql) {
    global $conn;
    $result = mysqli_query($conn, $sql);
    if (!$result) {
        die('Query failed: ' . mysqli_error($conn));
    }
    return $result;
}
