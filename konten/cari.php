<h2>Cari Data Member</h2>
<br />
<form action="index.php" method="get" style="margin-bottom: 20px;">
    <input type="hidden" name="module" value="cari" />
    <label for="username">Cari Username: </label>
    <input type="text" id="username" name="username" placeholder="Ketikan username" value="<?php echo htmlspecialchars($_GET['username'] ?? ''); ?>" required />
    <input type="submit" value="Cari" />
</form>

<?php
include_once __DIR__ . "/koneksi.php";

$username = isset($_GET['username']) ? trim($_GET['username']) : (isset($_POST['username']) ? trim($_POST['username']) : '');

if ($username !== '') {
    $hasil = false;
    if (isset($koneksi) && $koneksi) {
        $user_escaped = mysqli_real_escape_string($koneksi, $username);
        $select = "SELECT * FROM register WHERE username LIKE '%$user_escaped%'";
        $hasil  = mysqli_query($koneksi, $select);
    }
    ?>
    <h3>Hasil Pencarian untuk: "<?php echo htmlspecialchars($username); ?>"</h3>
    <br />
    <div style="overflow-x: auto; max-width: 100%; margin-top: 10px;">
        <table width="100%" border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; font-size: 11px; text-align: center;">
            <thead>
                <tr style="background-color: #f2f2f2;">
                    <th>ID</th>
                    <th>Nama Depan</th>
                    <th>Nama Belakang</th>
                    <th>Username</th>
                    <th>Password</th>
                    <th>Usia</th>
                    <th>JK</th>
                    <th>TTL</th>
                    <th>Email</th>
                    <th>No Telp</th>
                    <th colspan="2">Aksi</th>
                </tr>
            </thead>
            <tbody>
            <?php
            if ($hasil && mysqli_num_rows($hasil) > 0) {
                while ($buff = mysqli_fetch_array($hasil)) {
                    $id      = $buff['id'];
                    $namadep = isset($buff['namadep']) ? $buff['namadep'] : (isset($buff['nama_depan']) ? $buff['nama_depan'] : '');
                    $namabel = isset($buff['namabel']) ? $buff['namabel'] : (isset($buff['nama_belakang']) ? $buff['nama_belakang'] : '');
                    ?>
                    <tr>
                        <td><?php echo htmlspecialchars($id); ?></td>
                        <td><?php echo htmlspecialchars($namadep); ?></td>
                        <td><?php echo htmlspecialchars($namabel); ?></td>
                        <td><?php echo htmlspecialchars($buff['username'] ?? ''); ?></td>
                        <td><?php echo htmlspecialchars($buff['password'] ?? ''); ?></td>
                        <td><?php echo htmlspecialchars($buff['usia'] ?? ''); ?></td>
                        <td><?php echo htmlspecialchars($buff['jk'] ?? ''); ?></td>
                        <td><?php echo htmlspecialchars($buff['ttl'] ?? ''); ?></td>
                        <td><?php echo htmlspecialchars($buff['email'] ?? ''); ?></td>
                        <td><?php echo htmlspecialchars($buff['notel'] ?? ''); ?></td>
                        <td><a href="?module=edit&id=<?php echo $id; ?>">Edit</a></td>
                        <td><a href="?module=hapus&id=<?php echo $id; ?>" onclick="return confirm('Yakin ingin menghapus member ini?');">Hapus</a></td>
                    </tr>
                    <?php
                }
            } else {
                echo "<tr><td colspan='12'>Data member tidak ditemukan.</td></tr>";
            }
            ?>
            </tbody>
        </table>
    </div>
    <?php
}
?>
<br />
<a href="index.php">&lt;--- kembali ke menu utama</a>
