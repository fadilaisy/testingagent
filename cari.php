<?php
$username = isset($_GET['username']) ? urlencode($_GET['username']) : (isset($_POST['username']) ? urlencode($_POST['username']) : '');
if (!empty($username)) {
    header("Location: index.php?module=cari&username=" . $username);
} else {
    header("Location: index.php?module=cari");
}
exit;
?>
