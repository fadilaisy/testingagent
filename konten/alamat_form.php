<?php
include_once __DIR__ . "/alamat_tabel.php";

if (!isset($koneksi) || !$koneksi) {
    echo "<p style='color:red;'>Gagal terhubung ke database.</p>";
    return;
}

$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;   // id > 0 berarti mode edit

// ===== SIMPAN DATA (tambah atau edit) =====
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $nama      = trim($_POST['nama_pemilik'] ?? '');
    $alamat    = trim($_POST['alamat'] ?? '');
    $latitude  = $_POST['latitude'] ?? '';
    $longitude = $_POST['longitude'] ?? '';

    // validasi koordinat
    if ($nama === '' || $alamat === '' || !is_numeric($latitude) || !is_numeric($longitude)
        || $latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
        echo "<script>alert('Data belum lengkap atau koordinat tidak valid');history.back();</script>";
        return;
    }

    if ($id > 0) {
        $stmt = mysqli_prepare($koneksi, "UPDATE alamat SET nama_pemilik=?, alamat=?, latitude=?, longitude=? WHERE id=?");
        mysqli_stmt_bind_param($stmt, "ssddi", $nama, $alamat, $latitude, $longitude, $id);
        $pesan = 'Data alamat berhasil diubah';
    } else {
        $stmt = mysqli_prepare($koneksi, "INSERT INTO alamat (nama_pemilik, alamat, latitude, longitude) VALUES (?, ?, ?, ?)");
        mysqli_stmt_bind_param($stmt, "ssdd", $nama, $alamat, $latitude, $longitude);
        $pesan = 'Data alamat berhasil disimpan';
    }
    mysqli_stmt_execute($stmt);
    mysqli_stmt_close($stmt);

    echo "<script>alert('$pesan');window.location.href='?module=alamat#pos';</script>";
    return;
}

// ===== AMBIL DATA LAMA UNTUK MODE EDIT =====
$data = array('nama_pemilik' => '', 'alamat' => '', 'latitude' => '', 'longitude' => '');
if ($id > 0) {
    $stmt = mysqli_prepare($koneksi, "SELECT * FROM alamat WHERE id = ?");
    mysqli_stmt_bind_param($stmt, "i", $id);
    mysqli_stmt_execute($stmt);
    $baris = mysqli_fetch_assoc(mysqli_stmt_get_result($stmt));
    mysqli_stmt_close($stmt);
    if (!$baris) {
        echo "<p>Data tidak ditemukan.</p><a href='?module=alamat#pos'>kembali</a>";
        return;
    }
    $data = $baris;
}
?>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<h2><?php echo $id > 0 ? 'Edit Alamat Rumah' : 'Tambah Alamat Rumah'; ?></h2><br />

<form action="?module=alamat_form<?php echo $id > 0 ? '&id=' . $id : ''; ?>#pos" method="post">
    <table border="0" cellpadding="4">
        <tr>
            <td width="130">Nama Pemilik</td>
            <td><input type="text" name="nama_pemilik" size="40" required
                    value="<?php echo htmlspecialchars($data['nama_pemilik']); ?>" /></td>
        </tr>
        <tr>
            <td valign="top">Alamat Lengkap</td>
            <td><textarea name="alamat" rows="3" cols="50" required><?php echo htmlspecialchars($data['alamat']); ?></textarea></td>
        </tr>
        <tr>
            <td>Latitude</td>
            <td><input type="text" name="latitude" id="latitude" required
                    value="<?php echo htmlspecialchars($data['latitude']); ?>" /></td>
        </tr>
        <tr>
            <td>Longitude</td>
            <td><input type="text" name="longitude" id="longitude" required
                    value="<?php echo htmlspecialchars($data['longitude']); ?>" /></td>
        </tr>
        <tr>
            <td></td>
            <td>
                <button type="button" onclick="pakaiGPS()">Gunakan Lokasi Saya (GPS)</button>
                <span id="status" style="margin-left: 8px; color: #993300;"></span>
                <br /><small>Atau klik/geser penanda di peta untuk memilih lokasi rumah.</small>
            </td>
        </tr>
    </table>

    <div id="peta" style="width: 100%; height: 320px; border: 1px solid #003366; margin: 8px 0;"></div>

    <input type="submit" value="Simpan" />
    <a href="?module=alamat#pos">Batal</a>
</form>

<script>
var inputLat = document.getElementById('latitude');
var inputLng = document.getElementById('longitude');
var infoStatus = document.getElementById('status');

// posisi awal: data lama (mode edit) atau Jakarta
var awalLat = parseFloat(inputLat.value) || -6.2;
var awalLng = parseFloat(inputLng.value) || 106.8;

var peta = L.map('peta').setView([awalLat, awalLng], inputLat.value ? 16 : 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(peta);

var penanda = null;

// pindahkan penanda dan isi kotak latitude/longitude
function setLokasi(lat, lng, zoom) {
    inputLat.value = lat.toFixed(7);
    inputLng.value = lng.toFixed(7);
    if (penanda) {
        penanda.setLatLng([lat, lng]);
    } else {
        penanda = L.marker([lat, lng], { draggable: true }).addTo(peta);
        penanda.on('dragend', function () {
            var p = penanda.getLatLng();
            setLokasi(p.lat, p.lng);
        });
    }
    if (zoom) {
        peta.setView([lat, lng], zoom);
    }
}

// mode edit: tampilkan penanda di posisi lama
if (inputLat.value && inputLng.value) {
    setLokasi(awalLat, awalLng);
}

// klik di peta = pilih lokasi
peta.on('click', function (e) {
    setLokasi(e.latlng.lat, e.latlng.lng);
});

// ketik koordinat manual = penanda ikut pindah
function dariInput() {
    var lat = parseFloat(inputLat.value), lng = parseFloat(inputLng.value);
    if (!isNaN(lat) && !isNaN(lng)) {
        setLokasi(lat, lng, 16);
    }
}
inputLat.addEventListener('change', dariInput);
inputLng.addEventListener('change', dariInput);

// ambil lokasi dari GPS perangkat
function pakaiGPS() {
    if (!navigator.geolocation) {
        infoStatus.textContent = 'Browser tidak mendukung GPS.';
        return;
    }
    infoStatus.textContent = 'Mencari lokasi...';
    navigator.geolocation.getCurrentPosition(function (pos) {
        setLokasi(pos.coords.latitude, pos.coords.longitude, 17);
        infoStatus.textContent = 'Lokasi ditemukan (akurasi ±' + Math.round(pos.coords.accuracy) + ' m).';
    }, function (err) {
        infoStatus.textContent = 'Gagal mengambil lokasi: ' + err.message;
    }, { enableHighAccuracy: true, timeout: 15000 });
}
</script>
