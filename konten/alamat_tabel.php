<?php
// Koneksi + memastikan tabel "alamat" sudah ada
include_once __DIR__ . "/../koneksi/koneksi.php";

if (isset($koneksi) && $koneksi) {
    mysqli_query($koneksi, "CREATE TABLE IF NOT EXISTS `alamat` (
        `id` INT AUTO_INCREMENT PRIMARY KEY,
        `nama_pemilik` VARCHAR(100) NOT NULL,
        `alamat` TEXT NOT NULL,
        `latitude` DECIMAL(10,7) NOT NULL,
        `longitude` DECIMAL(10,7) NOT NULL
    )");
}
?>
