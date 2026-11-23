<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
if (isset($_SESSION['username'])) {
    ?>
    Selamat datang
    <?php echo '<strong>' . htmlspecialchars($_SESSION['username']) . '</strong>'; ?> <a href="?module=profil#pos">Profil Saya</a> | <a href="?module=logout#pos">Keluar</a>
    <?php
} else {
    echo "Silakan login terlebih dahulu.";
}
?>
