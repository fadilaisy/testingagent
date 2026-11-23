<?php
$host = "localhost";
$user = "admin";
$pass = "admin";
$db = "uinj_db";

$koneksi = @mysqli_connect($host, $user, $pass);

if ($koneksi) {
    mysqli_query($koneksi, "CREATE DATABASE IF NOT EXISTS `$db`");
    mysqli_select_db($koneksi, $db);
}
?>