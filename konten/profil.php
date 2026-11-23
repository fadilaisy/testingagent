<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Halaman profil hanya untuk pengguna yang sudah login
if (!isset($_SESSION['username'])) {
    echo "<script>alert('Silakan login terlebih dahulu');window.location.href='index.php';</script>";
    return;
}

include_once __DIR__ . "/../koneksi/koneksi.php";

if (!isset($koneksi) || !$koneksi) {
    echo "<p style='color:red;'>Gagal terhubung ke database.</p>";
    return;
}

// Pastikan tabel register punya kolom foto (untuk menyimpan nama file)
$cek_kolom = mysqli_query($koneksi, "SHOW COLUMNS FROM register LIKE 'foto'");
if ($cek_kolom && mysqli_num_rows($cek_kolom) == 0) {
    mysqli_query($koneksi, "ALTER TABLE register ADD foto VARCHAR(255) NULL");
}

$username   = $_SESSION['username'];
$folder     = __DIR__ . "/../image/foto/";   // lokasi file di server
$folder_url = "image/foto/";                 // lokasi file untuk tag <img>

// ===== PROSES UPLOAD =====
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['foto'])) {
    $file = $_FILES['foto'];

    if ($file['error'] !== UPLOAD_ERR_OK) {
        echo "<script>alert('Pilih file foto terlebih dahulu');window.location.href='?module=profil#pos';</script>";
        return;
    }

    // cek ekstensi dan isi file harus gambar
    $ekstensi_boleh = array('jpg', 'jpeg', 'png', 'gif');
    $ekstensi       = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $info_gambar    = @getimagesize($file['tmp_name']);

    if (!in_array($ekstensi, $ekstensi_boleh) || $info_gambar === false) {
        echo "<script>alert('File harus berupa gambar (jpg, jpeg, png, gif)');window.location.href='?module=profil#pos';</script>";
        return;
    }

    // batas ukuran 2 MB
    if ($file['size'] > 2 * 1024 * 1024) {
        echo "<script>alert('Ukuran foto maksimal 2 MB');window.location.href='?module=profil#pos';</script>";
        return;
    }

    if (!is_dir($folder)) {
        mkdir($folder, 0777, true);
    }

    // nama file unik: username_waktu.ekstensi
    $nama_aman = preg_replace('/[^a-zA-Z0-9_-]/', '', $username);
    $nama_baru = $nama_aman . '_' . time() . '.' . $ekstensi;

    if (move_uploaded_file($file['tmp_name'], $folder . $nama_baru)) {
        // ambil foto lama supaya bisa dihapus
        $stmt = mysqli_prepare($koneksi, "SELECT foto FROM register WHERE username = ?");
        mysqli_stmt_bind_param($stmt, "s", $username);
        mysqli_stmt_execute($stmt);
        mysqli_stmt_bind_result($stmt, $foto_lama);
        mysqli_stmt_fetch($stmt);
        mysqli_stmt_close($stmt);

        // simpan nama file baru ke database
        $stmt = mysqli_prepare($koneksi, "UPDATE register SET foto = ? WHERE username = ?");
        mysqli_stmt_bind_param($stmt, "ss", $nama_baru, $username);
        mysqli_stmt_execute($stmt);
        mysqli_stmt_close($stmt);

        if (!empty($foto_lama) && file_exists($folder . $foto_lama)) {
            unlink($folder . $foto_lama);
        }

        echo "<script>alert('Foto profil berhasil diunggah');window.location.href='?module=profil#pos';</script>";
    } else {
        echo "<script>alert('Foto gagal diunggah');window.location.href='?module=profil#pos';</script>";
    }
    return;
}

// ===== AMBIL DATA PENGGUNA YANG SEDANG LOGIN =====
$stmt = mysqli_prepare($koneksi, "SELECT * FROM register WHERE username = ? LIMIT 1");
mysqli_stmt_bind_param($stmt, "s", $username);
mysqli_stmt_execute($stmt);
$hasil = mysqli_stmt_get_result($stmt);
$data  = mysqli_fetch_assoc($hasil);
mysqli_stmt_close($stmt);
?>
<h2>Profil Saya</h2><br />

<table border="0" cellpadding="6">
    <tr>
        <td valign="top" width="170">
            <?php if (!empty($data['foto']) && file_exists($folder . $data['foto'])) { ?>
                <img src="<?php echo $folder_url . htmlspecialchars($data['foto']); ?>" alt="Foto Profil"
                    width="150" height="150" style="object-fit: cover; border: 1px solid #003366;" />
            <?php } else { ?>
                <div style="width: 150px; height: 150px; border: 1px dashed #003366; text-align: center; line-height: 150px; color: #999;">
                    Belum ada foto
                </div>
            <?php } ?>
        </td>
        <td valign="top">
            <table border="0" cellpadding="3">
                <tr><td>Username</td><td>: <strong><?php echo htmlspecialchars($data['username'] ?? ''); ?></strong></td></tr>
                <tr><td>Nama</td><td>: <?php echo htmlspecialchars(trim(($data['namadep'] ?? '') . ' ' . ($data['namabel'] ?? ''))); ?></td></tr>
                <tr><td>Usia</td><td>: <?php echo htmlspecialchars($data['usia'] ?? ''); ?></td></tr>
                <tr><td>Jenis Kelamin</td><td>: <?php echo htmlspecialchars($data['jk'] ?? ''); ?></td></tr>
                <tr><td>Tempat/Tgl Lahir</td><td>: <?php echo htmlspecialchars($data['ttl'] ?? ''); ?></td></tr>
                <tr><td>Email</td><td>: <?php echo htmlspecialchars($data['email'] ?? ''); ?></td></tr>
                <tr><td>No Telp</td><td>: <?php echo htmlspecialchars($data['notel'] ?? ''); ?></td></tr>
            </table>
        </td>
    </tr>
</table>

<h3 style="margin-top: 15px;">Upload Foto Profil</h3>
<form action="?module=profil#pos" method="post" enctype="multipart/form-data">
    <input type="file" name="foto" accept="image/*" required />
    <input type="submit" value="Upload" />
    <br /><small>Format: jpg, jpeg, png, gif. Maksimal 2 MB.</small>
</form>
