<?php
include_once __DIR__ . "/koneksi.php";

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['username'])) {
    // Ensure table exists
    $createTableSql = "CREATE TABLE IF NOT EXISTS `register` (
        `id` INT AUTO_INCREMENT PRIMARY KEY,
        `namadep` VARCHAR(100),
        `namabel` VARCHAR(100),
        `username` VARCHAR(100),
        `password` VARCHAR(255),
        `usia` INT,
        `jk` VARCHAR(20),
        `ttl` VARCHAR(100),
        `email` VARCHAR(100),
        `notel` VARCHAR(50)
    )";
    if (isset($koneksi) && $koneksi) {
        mysqli_query($koneksi, $createTableSql);
    }

    $namadep  = isset($_POST['namadep']) ? mysqli_real_escape_string($koneksi, $_POST['namadep']) : '';
    $namabel  = isset($_POST['namabel']) ? mysqli_real_escape_string($koneksi, $_POST['namabel']) : '';
    $username = isset($_POST['username']) ? mysqli_real_escape_string($koneksi, $_POST['username']) : '';
    $password = isset($_POST['password']) ? mysqli_real_escape_string($koneksi, $_POST['password']) : '';
    $usia     = isset($_POST['usia']) ? intval($_POST['usia']) : 0;
    $jk       = isset($_POST['jk']) ? mysqli_real_escape_string($koneksi, $_POST['jk']) : '';
    $ttl      = isset($_POST['ttl']) ? mysqli_real_escape_string($koneksi, $_POST['ttl']) : '';
    $email    = isset($_POST['email']) ? mysqli_real_escape_string($koneksi, $_POST['email']) : '';
    $notel    = isset($_POST['notel']) ? mysqli_real_escape_string($koneksi, $_POST['notel']) : '';

    $sql = "INSERT INTO register (namadep, namabel, username, password, usia, jk, ttl, email, notel) 
            VALUES ('$namadep', '$namabel', '$username', '$password', $usia, '$jk', '$ttl', '$email', '$notel')";

    if (isset($koneksi) && $koneksi && mysqli_query($koneksi, $sql)) {
        echo "<script>alert('Selamat, anda telah terdaftar'); window.location.href='index.php';</script>";
    } else {
        $errorMsg = (isset($koneksi) && $koneksi) ? mysqli_error($koneksi) : "Koneksi database belum terhubung.";
        echo "<script>alert('Hasil: " . addslashes($errorMsg) . "'); window.location.href='index.php';</script>";
    }
} else {
    include __DIR__ . "/index.php";
}
?>