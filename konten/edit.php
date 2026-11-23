<?php
include_once __DIR__ . "/koneksi.php";

$id = isset($_GET['id']) ? intval($_GET['id']) : 0;
$data = null;

if (isset($koneksi) && $koneksi && $id > 0) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $namadep = mysqli_real_escape_string($koneksi, $_POST['namadep'] ?? '');
        $namabel = mysqli_real_escape_string($koneksi, $_POST['namabel'] ?? '');
        $username = mysqli_real_escape_string($koneksi, $_POST['username'] ?? '');
        $password = mysqli_real_escape_string($koneksi, $_POST['password'] ?? '');
        $usia = intval($_POST['usia'] ?? 0);
        $jk = mysqli_real_escape_string($koneksi, $_POST['jk'] ?? '');
        $ttl = mysqli_real_escape_string($koneksi, $_POST['ttl'] ?? '');
        $email = mysqli_real_escape_string($koneksi, $_POST['email'] ?? '');
        $notel = mysqli_real_escape_string($koneksi, $_POST['notel'] ?? '');

        $update = "UPDATE register SET 
                    namadep='$namadep', 
                    namabel='$namabel', 
                    username='$username', 
                    password='$password', 
                    usia=$usia, 
                    jk='$jk', 
                    ttl='$ttl', 
                    email='$email', 
                    notel='$notel' 
                   WHERE id=$id";

        if (mysqli_query($koneksi, $update)) {
            echo "<script>alert('Data berhasil diperbarui'); window.location.href='index.php?module=lihat';</script>";
            exit;
        } else {
            echo "<script>alert('Gagal mengupdate data: " . addslashes(mysqli_error($koneksi)) . "');</script>";
        }
    }

    $res = mysqli_query($koneksi, "SELECT * FROM register WHERE id = $id");
    if ($res && mysqli_num_rows($res) > 0) {
        $data = mysqli_fetch_assoc($res);
    }
}

if (!$data) {
    echo "<p>Data member tidak ditemukan.</p>";
    echo "<a href='index.php?module=lihat'>Kembali ke daftar member</a>";
    return;
}
?>

<h3>Edit Data Member</h3>
<form action="index.php?module=edit&id=<?php echo $id; ?>" method="post">
    <table width="100%" border="0" cellpadding="5">
        <tr>
            <td width="150">Nama Depan: </td>
            <td><input type="text" name="namadep"
                    value="<?php echo htmlspecialchars($data['namadep'] ?? $data['nama_depan'] ?? ''); ?>" required />
            </td>
        </tr>
        <tr>
            <td>Nama Belakang: </td>
            <td><input type="text" name="namabel"
                    value="<?php echo htmlspecialchars($data['namabel'] ?? $data['nama_belakang'] ?? ''); ?>" /></td>
        </tr>
        <tr>
            <td>Username: </td>
            <td><input type="text" name="username" value="<?php echo htmlspecialchars($data['username'] ?? ''); ?>"
                    required /></td>
        </tr>
        <tr>
            <td>Password: </td>
            <td><input type="text" name="password" value="<?php echo htmlspecialchars($data['password'] ?? ''); ?>"
                    required /></td>
        </tr>
        <tr>
            <td>Usia: </td>
            <td><input type="number" name="usia" value="<?php echo htmlspecialchars($data['usia'] ?? '0'); ?>" /></td>
        </tr>
        <tr>
            <td>Jenis Kelamin: </td>
            <td><input type="text" name="jk" value="<?php echo htmlspecialchars($data['jk'] ?? ''); ?>" /></td>
        </tr>
        <tr>
            <td>Tempat/Tgl Lahir: </td>
            <td><input type="text" name="ttl" value="<?php echo htmlspecialchars($data['ttl'] ?? ''); ?>" /></td>
        </tr>
        <tr>
            <td>Email: </td>
            <td><input type="email" name="email" value="<?php echo htmlspecialchars($data['email'] ?? ''); ?>" /></td>
        </tr>
        <tr>
            <td>Nomor Telepon: </td>
            <td><input type="text" name="notel" value="<?php echo htmlspecialchars($data['notel'] ?? ''); ?>" /></td>
        </tr>
        <tr>
            <td>&nbsp;</td>
            <td>
                <input type="submit" value="Simpan Perubahan" />
                <a href="index.php?module=lihat" style="margin-left:10px;">Batal</a>
            </td>
        </tr>
    </table>
</form>