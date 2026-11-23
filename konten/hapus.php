<?php
include_once __DIR__ . "/koneksi.php";

if (isset($_GET['id'])) {
    $id = intval($_GET['id']);
    if (isset($koneksi) && $koneksi && $id > 0) {
        $query = "DELETE FROM register WHERE id = $id";
        mysqli_query($koneksi, $query);
    }
}
echo "<script>alert('Data berhasil dihapus'); window.location.href='index.php?module=lihat';</script>";
?>
