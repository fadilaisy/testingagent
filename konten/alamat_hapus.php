<?php
include_once __DIR__ . "/alamat_tabel.php";

$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
if (isset($koneksi) && $koneksi && $id > 0) {
    $stmt = mysqli_prepare($koneksi, "DELETE FROM alamat WHERE id = ?");
    mysqli_stmt_bind_param($stmt, "i", $id);
    mysqli_stmt_execute($stmt);
    mysqli_stmt_close($stmt);
}
echo "<script>alert('Data alamat berhasil dihapus');window.location.href='index.php?module=alamat#pos';</script>";
?>
