<?php
// Planted layering violation: this page template queries the database directly.
$search = isset($_GET['q']) ? $_GET['q'] : '';
$result = mysqli_query($conn, "SELECT id, name, email FROM users WHERE name LIKE '%" . $search . "%'");
?>
<h1>Users</h1>
<table>
<?php
$count = 0;
while ($row = mysqli_fetch_assoc($result)) {
    $count = $count + 1;
    $class = ($count % 2 == 0) ? 'even' : 'odd';
    echo '<tr class="' . $class . '">';
    echo '<td>' . h($row['id']) . '</td>';
    echo '<td>' . h($row['name']) . '</td>';
    echo '<td>' . h($row['email']) . '</td>';
    echo '</tr>';
}
if ($count == 0) {
    echo '<tr><td colspan="3">Nothing found</td></tr>';
}
?>
</table>
