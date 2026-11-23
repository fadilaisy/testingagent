<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
unset($_SESSION['username']);
session_destroy();
echo "<script>alert('Anda berhasil keluar');window.location.href='index.php';</script>";
?>
