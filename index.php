<?php session_start(); ?>
<html xmlns="http://www.w3.org/1999/xhtml">

<head>
	<meta http-equiv="content-type" content="text/html; charset=utf-8" />
	<title>MyWebsite</title>
	<link href="style/style.css" type="text/css" rel="stylesheet" />
</head>

<body>
	<div id="container">
		<div id="header">
			<h1>Pertemuan 1 - Sistem pakar</h1>
		</div>

		<div id="sidebar">
			<h3>navigasi</h3>
			<ul id="navmenu">
				<li><a href="index.php" class="<?php echo !isset($_GET['module']) ? 'selected' : ''; ?>">profile</a>
				</li>
				<li><a href="?module=galeri#pos"
						class="<?php echo (isset($_GET['module']) && $_GET['module'] == 'galeri') ? 'selected' : ''; ?>">galeri</a>
				</li>
				<li><a href="?module=jadwal#pos"
						class="<?php echo (isset($_GET['module']) && $_GET['module'] == 'jadwal') ? 'selected' : ''; ?>">jadwal
						kuliah</a></li>
				<li><a href="?module=input#pos"
						class="<?php echo (isset($_GET['module']) && $_GET['module'] == 'input') ? 'selected' : ''; ?>">register</a>
				</li>
				<li><a href="?module=lihat#pos"
						class="<?php echo (isset($_GET['module']) && $_GET['module'] == 'lihat') ? 'selected' : ''; ?>">lihat
						member</a></li>
				<li><a href="?module=cari#pos"
						class="<?php echo (isset($_GET['module']) && $_GET['module'] == 'cari') ? 'selected' : ''; ?>">cari
						data</a></li>
				<li><a href="?module=alamat#pos"
						class="<?php echo (isset($_GET['module']) && strpos($_GET['module'], 'alamat') === 0) ? 'selected' : ''; ?>">alamat
						rumah</a></li>
				<?php if (isset($_SESSION['username'])) { ?>
				<li><a href="?module=profil#pos"
						class="<?php echo (isset($_GET['module']) && $_GET['module'] == 'profil') ? 'selected' : ''; ?>">profil
						saya</a></li>
				<?php } ?>
			</ul>

			<h3>login</h3>
			<div style="padding: 0 10px 10px 10px;">
				<?php if (isset($_SESSION['username'])) { ?>
					Selamat datang<br />
					<strong><?php echo htmlspecialchars($_SESSION['username']); ?></strong><br />
					<a href="?module=profil#pos">Profil Saya</a> |
					<a href="?module=logout#pos">Keluar</a>
				<?php } else { ?>
					<form action="?module=loginproc#pos" method="post">
						Username<br />
						<input type="text" name="username" style="width: 130px;" required /><br />
						Password<br />
						<input type="password" name="password" style="width: 130px;" required /><br />
						<input type="submit" value="Login" />
					</form>
				<?php } ?>
			</div>
		</div>

		<div id="page">
			<?php
			if (isset($_GET['module']) && file_exists(__DIR__ . "/konten/" . $_GET['module'] . ".php")) {
				include __DIR__ . "/konten/" . $_GET['module'] . ".php";
			} else {
				include __DIR__ . "/konten/home.php";
			}
			?>
			<h2>&nbsp;</h2>
		</div>

		<div id="clear"></div>

		<div id="footer">
			<p>&copy; 2010</p>
		</div>
	</div>
</body>

</html>