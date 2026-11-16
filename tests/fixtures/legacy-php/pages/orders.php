<?php
$result = db_query("SELECT id, name, email FROM orders_view ORDER BY id DESC");
?>
<h1>Orders</h1>
<p><?php echo monthly_report(date('n')); ?></p>
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
