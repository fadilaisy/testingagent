<?php
include_once __DIR__ . "/alamat_tabel.php";

if (!isset($koneksi) || !$koneksi) {
    echo "<p style='color:red;'>Gagal terhubung ke database.</p>";
    return;
}

$hasil = mysqli_query($koneksi, "SELECT * FROM alamat ORDER BY id");
$data  = array();
while ($row = mysqli_fetch_assoc($hasil)) {
    $data[] = $row;
}
?>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<h2>Data Alamat Rumah</h2><br />
<a href="?module=alamat_form#pos">+ Tambah Alamat</a>
<br /><br />

<!-- Peta semua rumah -->
<div id="peta" style="width: 100%; height: 350px; border: 1px solid #003366;"></div>
<br />

<table width="100%" border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; font-size: 11px;">
    <tr style="background-color: #99ccff;">
        <th>No</th>
        <th>Nama Pemilik</th>
        <th>Alamat Lengkap</th>
        <th>Latitude</th>
        <th>Longitude</th>
        <th colspan="3">Aksi</th>
    </tr>
    <?php if (count($data) == 0) { ?>
        <tr><td colspan="8" align="center">Belum ada data alamat.</td></tr>
    <?php } ?>
    <?php foreach ($data as $no => $d) { ?>
        <tr>
            <td align="center"><?php echo $no + 1; ?></td>
            <td><?php echo htmlspecialchars($d['nama_pemilik']); ?></td>
            <td><?php echo htmlspecialchars($d['alamat']); ?></td>
            <td><?php echo $d['latitude']; ?></td>
            <td><?php echo $d['longitude']; ?></td>
            <td align="center"><a href="#peta" onclick="lihatRumah(<?php echo $d['id']; ?>)">lihat</a></td>
            <td align="center"><a href="?module=alamat_form&id=<?php echo $d['id']; ?>#pos">edit</a></td>
            <td align="center"><a href="?module=alamat_hapus&id=<?php echo $d['id']; ?>"
                    onclick="return confirm('Yakin ingin menghapus alamat ini?');">hapus</a></td>
        </tr>
    <?php } ?>
</table>

<script>
// data rumah dari database (PHP -> JavaScript)
var rumah = <?php echo json_encode($data); ?>;

// buat peta OpenStreetMap, posisi awal Jakarta
var peta = L.map('peta').setView([-6.2, 106.8], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(peta);

// pasang satu marker untuk setiap rumah
var marker = {};
var titik  = [];
rumah.forEach(function (r) {
    var lat = parseFloat(r.latitude), lng = parseFloat(r.longitude);
    var div = document.createElement('div');
    div.innerHTML = '<b></b><br><span></span><br>';
    div.querySelector('b').textContent = r.nama_pemilik;
    div.querySelector('span').textContent = r.alamat;
    div.innerHTML += '<a target="_blank" href="https://www.google.com/maps?q=' + lat + ',' + lng + '">Buka di Google Maps</a>';
    marker[r.id] = L.marker([lat, lng]).addTo(peta).bindPopup(div);
    titik.push([lat, lng]);
});

// zoom otomatis supaya semua rumah terlihat
if (titik.length == 1) {
    peta.setView(titik[0], 16);
} else if (titik.length > 1) {
    peta.fitBounds(titik, { padding: [30, 30] });
}

// tombol "lihat" di tabel: zoom ke rumah tersebut
function lihatRumah(id) {
    if (marker[id]) {
        peta.setView(marker[id].getLatLng(), 17);
        marker[id].openPopup();
    }
}
</script>
<br />
<a href="index.php">&lt;--- kembali ke index</a>
