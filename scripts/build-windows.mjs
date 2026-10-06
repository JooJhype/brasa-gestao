import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  constants, copyFileSync, createReadStream, lstatSync, mkdirSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realProjectRoot = realpathSync(projectRoot);
const distDir = path.join(projectRoot, 'dist');
const installerDir = path.join(projectRoot, 'Instalador');
const require = createRequire(path.join(projectRoot, 'package.json'));
const installerPattern = /^Brasa-Instalador-[A-Za-z0-9.+-]+-x64\.exe(?:\.blockmap)?$/;

function checkedDirectory(directory, name) {
  // Never recursively remove a computed path until its exact location is checked.
  if (!path.isAbsolute(directory) || directory !== path.join(projectRoot, name)
      || path.dirname(directory) !== projectRoot || path.relative(projectRoot, directory) !== name) {
    throw new Error(`Pasta fora do projeto: ${directory}`);
  }
  const info = lstatSync(directory, { throwIfNoEntry: false });
  if (info && (info.isSymbolicLink() || !info.isDirectory()
      || realpathSync(directory) !== path.join(realProjectRoot, name))) {
    throw new Error(`A pasta ${name} precisa ser um diretório normal dentro do projeto, sem links ou junções.`);
  }
}

function checkedFile(filename, directory) {
  if (path.dirname(filename) !== directory) throw new Error(`Arquivo fora da pasta esperada: ${filename}`);
  const info = lstatSync(filename, { throwIfNoEntry: false });
  if (info && (info.isSymbolicLink() || !info.isFile())) {
    throw new Error(`O arquivo precisa ser regular, sem links: ${filename}`);
  }
  return info;
}

async function fingerprint(filename, directory) {
  const info = checkedFile(filename, directory);
  if (!info || info.size === 0) throw new Error(`Instalador inexistente ou vazio: ${filename}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return { size: info.size, sha256: hash.digest('hex') };
}

function equalFingerprint(left, right) {
  return left.size === right.size && left.sha256 === right.sha256;
}

async function build() {
  checkedDirectory(distDir, 'dist');
  checkedDirectory(installerDir, 'Instalador');
  const { version } = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)) {
    throw new Error('A versão do package.json não é válida para gerar o instalador.');
  }
  const installerName = `Brasa-Instalador-${version}-x64.exe`;
  const source = path.join(distDir, installerName);
  const destination = path.join(installerDir, installerName);
  const cli = require.resolve('electron-builder/cli.js');
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--config', 'electron-builder.json', '--win', '--x64', '--publish', 'never'], {
      cwd: projectRoot, stdio: 'inherit', windowsHide: true,
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) reject(new Error(`O empacotamento foi interrompido por ${signal}.`));
      else resolve(code);
    });
  });
  if (exitCode !== 0) {
    throw new Error(`O empacotamento falhou (código ${exitCode}). O instalador anterior e os arquivos de diagnóstico em dist foram preservados.`);
  }

  checkedDirectory(distDir, 'dist');
  checkedDirectory(installerDir, 'Instalador');
  mkdirSync(installerDir, { recursive: true });
  checkedDirectory(installerDir, 'Instalador');
  checkedFile(destination, installerDir);
  const oldInstallers = readdirSync(installerDir)
    .filter(name => installerPattern.test(name) && name !== installerName)
    .map(name => path.join(installerDir, name));
  for (const filename of oldInstallers) checkedFile(filename, installerDir);

  const temporary = path.join(installerDir, `.${installerName}.${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    checkedFile(source, distDir);
    copyFileSync(source, temporary, constants.COPYFILE_EXCL);
    temporaryCreated = true;
    const [sourceHash, copyHash] = await Promise.all([
      fingerprint(source, distDir), fingerprint(temporary, installerDir),
    ]);
    if (!equalFingerprint(sourceHash, copyHash)) {
      throw new Error('A cópia do instalador não passou na conferência de tamanho e SHA256. O instalador anterior foi preservado.');
    }
    checkedDirectory(installerDir, 'Instalador');
    checkedFile(destination, installerDir);
    // Renaming the verified copy avoids truncating a previous installer on copy failure.
    renameSync(temporary, destination);
    temporaryCreated = false;
    const savedHash = await fingerprint(destination, installerDir);
    if (!equalFingerprint(sourceHash, savedHash)) throw new Error('O instalador final não passou na conferência. dist foi mantido para diagnóstico.');

    checkedDirectory(installerDir, 'Instalador');
    for (const filename of oldInstallers) {
      checkedFile(filename, installerDir);
      rmSync(filename, { force: true });
    }
    // Only the generated dist directory is removed; source and local data stay intact.
    checkedDirectory(distDir, 'dist');
    rmSync(distDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    console.log(`\nInstalador pronto: ${destination}`);
    console.log(`Tamanho: ${savedHash.size} bytes · SHA256: ${savedHash.sha256}`);
    console.log('Arquivos gerados de dist e instaladores anteriores foram removidos.');
  } finally {
    if (temporaryCreated) {
      checkedDirectory(installerDir, 'Instalador');
      checkedFile(temporary, installerDir);
      rmSync(temporary, { force: true });
    }
  }
}

build().catch(error => {
  console.error(`\nNão foi possível concluir o empacotamento: ${error.message}`);
  process.exitCode = 1;
});
