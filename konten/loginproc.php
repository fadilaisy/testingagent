<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
include_once __DIR__ . "/../koneksi/koneksi.php";

$username = isset($_POST['username']) ? $_POST['username'] : '';
$password = isset($_POST['password']) ? $_POST['password'] : '';
$berhasil = false;

if (isset($koneksi) && $koneksi && $username !== '') {
    // pakai tabel "register" dari database uinj_db
    $stmt = mysqli_prepare($koneksi, "SELECT username FROM register WHERE username = ? AND password = ?");
    mysqli_stmt_bind_param($stmt, "ss", $username, $password);
    mysqli_stmt_execute($stmt);
    mysqli_stmt_store_result($stmt);
    $berhasil = (mysqli_stmt_num_rows($stmt) >= 1);
    mysqli_stmt_close($stmt);
}

if ($berhasil) {
    $_SESSION['username'] = $username;
    echo "<script>alert('Anda berhasil masuk');window.location.href='index.php?module=indexuser#pos';</script>";
} else {
    echo "<script>alert('Anda gagal masuk');window.location.href='index.php';</script>";
}
?>
