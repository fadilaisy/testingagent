<h2>Daftar Member</h2><br />
<?php
include_once __DIR__ . "/../koneksi/koneksi.php";

if (!isset($koneksi) || !$koneksi) {
    $err = !empty($koneksi_error) ? $koneksi_error : "Gagal terhubung ke Database MySQL.";
    echo "<div style='color: red; padding: 10px; border: 1px solid red; background-color: #ffe6e6; margin-bottom: 15px;'>";
    echo "<strong>Peringatan Koneksi Database:</strong> " . htmlspecialchars($err) . "<br />";
    echo "<small>Jika MySQL XAMPP Anda menggunakan password, buka file <code>koneksi/koneksi.php</code> lalu isi variabel <code>\$pass = \"password_anda\";</code></small>";
    echo "</div>";
} else {
    // ===== PAGINATION =====
    $batas   = 5;                                                  // jumlah record per halaman
    $halaman = isset($_GET['halaman']) ? (int) $_GET['halaman'] : 1; // halaman yang dipilih
    if ($halaman < 1) {
        $halaman = 1;
    }

    // hitung total data dan total halaman
    $jumlah     = mysqli_query($koneksi, "SELECT COUNT(*) AS total FROM register");
    $total_data = (int) mysqli_fetch_assoc($jumlah)['total'];
    $total_hal  = max(1, (int) ceil($total_data / $batas));
    if ($halaman > $total_hal) {
        $halaman = $total_hal;
    }

    // posisi data pertama di halaman ini
    $mulai = ($halaman - 1) * $batas;

    $select = "SELECT * FROM register LIMIT $mulai, $batas";
    $hasil = mysqli_query($koneksi, $select);
    ?>
    <div style="overflow-x: auto; max-width: 100%; margin-top: 10px;">
        <table width="100%" border="1" cellpadding="4" cellspacing="0"
            style="border-collapse: collapse; font-size: 11px; text-align: center;">
            <thead>
                <tr style="background-color: #f0f0f0;">
                    <th>id</th>
                    <th>nama depan</th>
                    <th>nama belakang</th>
                    <th>username</th>
                    <th>password</th>
                    <th>usia</th>
                    <th>jk</th>
                    <th>ttl</th>
                    <th>email</th>
                    <th>notel</th>
                    <th colspan="2">aksi</th>
                </tr>
            </thead>
            <tbody>
                <?php
                if ($hasil && mysqli_num_rows($hasil) > 0) {
                    while ($buff = mysqli_fetch_array($hasil)) {
                        $id = $buff['id'];
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
                            <td><a href="?module=edit&id=<?php echo $id; ?>">edit</a></td>
                            <td><a href="?module=hapus&id=<?php echo $id; ?>"
                                    onclick="return confirm('Yakin ingin menghapus data ini?');">hapus</a></td>
                        </tr>
                        <?php
                    }
                } else {
                    echo "<tr><td colspan='12' align='center'>Belum ada data member terdaftar.</td></tr>";
                }
                ?>
            </tbody>
        </table>
    </div>

    <!-- ===== NAVIGASI HALAMAN ===== -->
    <p style="margin-top: 10px;">
        Menampilkan halaman <strong><?php echo $halaman; ?></strong> dari <?php echo $total_hal; ?>
        (total <?php echo $total_data; ?> data)
    </p>
    <div style="margin-top: 5px;">
        <?php
        // tombol Previous
        if ($halaman > 1) {
            echo "<a href='?module=lihat&halaman=" . ($halaman - 1) . "' style='padding: 3px 8px; border: 1px solid #003366; margin-right: 3px; text-decoration: none;'>&laquo; Previous</a>";
        } else {
            echo "<span style='padding: 3px 8px; border: 1px solid #ccc; color: #999; margin-right: 3px;'>&laquo; Previous</span>";
        }

        // nomor halaman
        for ($i = 1; $i <= $total_hal; $i++) {
            if ($i == $halaman) {
                echo "<span style='padding: 3px 8px; border: 1px solid #003366; background-color: #003366; color: #fff; margin-right: 3px;'>$i</span>";
            } else {
                echo "<a href='?module=lihat&halaman=$i' style='padding: 3px 8px; border: 1px solid #003366; margin-right: 3px; text-decoration: none;'>$i</a>";
            }
        }

        // tombol Next
        if ($halaman < $total_hal) {
            echo "<a href='?module=lihat&halaman=" . ($halaman + 1) . "' style='padding: 3px 8px; border: 1px solid #003366; text-decoration: none;'>Next &raquo;</a>";
        } else {
            echo "<span style='padding: 3px 8px; border: 1px solid #ccc; color: #999;'>Next &raquo;</span>";
        }
        ?>
    </div>
    <?php
}
?><br />
<a href="index.php">&lt;--- kembali ke index</a>