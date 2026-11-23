# Web PHP: pagination + upload foto profil

Site from the 12409011030034-32 folder, with:
- Pagination on "lihat member" (`konten/lihat.php`, 5 records per page, Previous / numbers / Next)
- Upload foto profil (`konten/profil.php`, saves the file in `image/foto/` and the file name in `register.foto`)

## Run on Mac
1. Install XAMPP (or MAMP) and start Apache + MySQL.
2. Clone into the web folder:
   `git clone -b php-pagination-upload https://github.com/fadilaisy/testingagent.git /Applications/XAMPP/htdocs/12409011030034-32`
3. Make the upload folder writable: `chmod 777 /Applications/XAMPP/htdocs/12409011030034-32/image/foto`
4. Check `koneksi/koneksi.php` (host `localhost`; user/password must match your MySQL, e.g. `root` with empty password).
5. Open http://localhost/12409011030034-32/ , register a user, log in, then open "profil saya".

The database `uinj_db`, the `register` table and the `foto` column are created automatically.

## Alamat rumah + GPS (peta OpenStreetMap)
Menu "alamat rumah" (`konten/alamat.php`, `alamat_form.php`, `alamat_hapus.php`, `alamat_tabel.php`):
- Simpan nama pemilik, alamat lengkap, latitude, longitude (tabel `alamat` dibuat otomatis)
- Koordinat diisi lewat tombol GPS ("Gunakan Lokasi Saya"), klik/geser penanda di peta, atau ketik manual
- Semua rumah tampil sebagai penanda di peta OpenStreetMap (Leaflet), dengan tombol lihat/edit/hapus
- Butuh internet untuk memuat Leaflet dan peta
