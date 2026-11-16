<?php
// Front controller, sort of. Grew organically since 2009.
require_once 'includes/db.php';
require_once 'includes/functions.php';

session_start();

$page = isset($_GET['page']) ? $_GET['page'] : 'home';

switch ($page) {
    case 'users':
        include 'pages/users.php';
        break;
    case 'orders':
        include 'pages/orders.php';
        break;
    default:
        // dynamic include, cannot be resolved statically
        $file = 'pages/' . $page . '.php';
        if (file_exists($file)) {
            include $file;
        } else {
            echo '<h1>Welcome</h1>';
        }
}
