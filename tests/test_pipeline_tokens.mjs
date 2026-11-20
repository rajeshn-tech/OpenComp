/**
 * OpenComp - Pipeline Tokens & Path Resolution Automated Test Suite
 * Milestone: Phase 6.1 (Production Ecosystem)
 */

import assert from 'node:assert/strict';
import { PipelineTokens, globalPipelineTokens } from '../src/core/PipelineTokens.js';

console.log('🧪 Starting OpenComp Phase 6.1 Pipeline Tokens & Path Resolution Tests...');

// 1. Frame Formatting Tests (Various paddings & negative numbers)
{
  assert.equal(PipelineTokens.formatFrame(1, 4), '0001');
  assert.equal(PipelineTokens.formatFrame(42, 4), '0042');
  assert.equal(PipelineTokens.formatFrame(1042, 4), '1042');
  assert.equal(PipelineTokens.formatFrame(99999, 4), '99999'); // Overflow beyond pad length
  assert.equal(PipelineTokens.formatFrame(5, 3), '005');
  assert.equal(PipelineTokens.formatFrame(5, 5), '00005');
  assert.equal(PipelineTokens.formatFrame(7, 1), '7');
  assert.equal(PipelineTokens.formatFrame(0, 4), '0000');
  assert.equal(PipelineTokens.formatFrame(-10, 4), '-0010');
  assert.equal(PipelineTokens.formatFrame(-1, 3), '-001');
  console.log('  ✅ 1. Frame padding and negative number formatting passed');
}

// 2. Standard Tokens Resolution (${SHOT}, ${SEQUENCE}, ${VERSION}, ${PROJECT}, ${ASSET})
{
  const tokens = new PipelineTokens({
    tokens: {
      SHOT: 'sh042',
      SEQUENCE: 'sq01',
      VERSION: 'v003',
      PROJECT: 'AvatarVFX',
      ASSET: 'hero_ship'
    }
  });

  // Multiple ${TOKEN} in one path
  const tpl1 = '/shows/${PROJECT}/${SEQUENCE}/${SHOT}/assets/${ASSET}/comp/${VERSION}/shot.####.exr';
  const res1 = tokens.resolve(tpl1, { frame: 1001 });
  assert.equal(res1, '/shows/AvatarVFX/sq01/sh042/assets/hero_ship/comp/v003/shot.1001.exr');

  // $TOKEN non-bracketed syntax
  const tpl2 = '/renders/$PROJECT/$SEQUENCE/$SHOT/$ASSET_$VERSION.%04d.exr';
  const res2 = tokens.resolve(tpl2, { frame: 25 });
  assert.equal(res2, '/renders/AvatarVFX/sq01/sh042/hero_ship_v003.0025.exr');

  // Case-insensitive key matching (lowercase context resolving uppercase token definition)
  const tpl3 = '/path/{project}/{shot}/plate.###.dpx';
  const res3 = tokens.resolve(tpl3, { frame: 5 });
  assert.equal(res3, '/path/AvatarVFX/sh042/plate.005.dpx');

  // Context overriding pre-configured tokens
  const res4 = tokens.resolve(tpl1, { frame: 50, VERSION: 'v004', SHOT: 'sh043' });
  assert.equal(res4, '/shows/AvatarVFX/sq01/sh043/assets/hero_ship/comp/v004/shot.0050.exr');

  console.log('  ✅ 2. Standard tokens (${SHOT}, ${SEQUENCE}, etc.) and multi-token paths passed');
}

// 3. Escaped Literal Tokens (\${SHOT}, \$SHOT, \####, \%04d, \\)
{
  const tokens = new PipelineTokens({
    tokens: {
      SHOT: 'sh010',
      PROJECT: 'Demo'
    }
  });

  const escapedTpl = '/path/\\${PROJECT}/\\$SHOT/\\####/\\%04d/file.exr';
  const res = tokens.resolve(escapedTpl, { frame: 1042 });
  assert.equal(res, '/path/${PROJECT}/$SHOT/####/%04d/file.exr');

  // Escaped backslash \\
  const tplSlash = 'C:\\\\studio\\\\projects\\\\$PROJECT\\\\shot.exr';
  const resSlash = tokens.resolve(tplSlash);
  assert.equal(resSlash, 'C:\\studio\\projects\\Demo\\shot.exr');

  console.log('  ✅ 3. Escaped literal tokens passed');
}

// 4. Missing Tokens & Error Handling (Strict vs Non-Strict)
{
  const tokens = new PipelineTokens({
    tokens: { PROJECT: 'Demo' }
  });

  // Non-strict mode: leaves unresolved token unchanged
  const nonStrict = tokens.resolve('/shows/${PROJECT}/${MISSING_TOKEN}/shot.exr');
  assert.equal(nonStrict, '/shows/Demo/${MISSING_TOKEN}/shot.exr');

  // Strict mode: throws clear error message
  assert.throws(() => {
    tokens.resolve('/shows/${PROJECT}/${UNRESOLVED_TOKEN}/shot.exr', {}, { strict: true });
  }, /MissingTokenError: Unresolved token "\${UNRESOLVED_TOKEN}"/);

  assert.throws(() => {
    tokens.resolve('/shows/$MISSING/shot.exr', {}, { strict: true });
  }, /MissingTokenError: Unresolved token "\$MISSING"/);

  console.log('  ✅ 4. Missing tokens and strict error handling passed');
}

// 5. Legacy Path Compatibility (Paths without tokens are untouched)
{
  const tokens = new PipelineTokens({ PROJECT: 'Demo' });

  const legacyWin = 'C:\\Projects\\Comp\\renders\\beauty.1001.exr';
  assert.equal(tokens.resolve(legacyWin), legacyWin);

  const legacyLinux = '/mnt/storage/projects/shot01/comp.mov';
  assert.equal(tokens.resolve(legacyLinux), legacyLinux);

  const legacyRelative = '../footage/plate_clean.png';
  assert.equal(tokens.resolve(legacyRelative), legacyRelative);

  console.log('  ✅ 5. Legacy path compatibility (untouched) passed');
}

// 6. Cross-Platform Path Mapping (Windows Drive, UNC <--> Linux NFS)
{
  const tokens = new PipelineTokens({
    pathMappings: [
      {
        name: 'Show Storage',
        windows: 'Z:\\show\\project\\shot',
        linux: '/mnt/show/project/shot',
        caseSensitive: false
      },
      {
        name: 'UNC Projects',
        windows: '\\\\studio-storage\\projects',
        linux: '/mnt/storage/projects',
        caseSensitive: false
      }
    ]
  });

  // Windows Drive Letter to Linux NFS
  const winDrive = 'Z:\\show\\project\\shot\\comp\\beauty.1001.exr';
  const linuxFromDrive = tokens.mapPath(winDrive, 'linux');
  assert.equal(linuxFromDrive, '/mnt/show/project/shot/comp/beauty.1001.exr');

  // Case-insensitive Windows drive mapping (e.g. z:\SHOW\...)
  const winCase = 'z:\\SHOW\\project\\shot\\plates\\plate.exr';
  const linuxFromCase = tokens.mapPath(winCase, 'linux');
  assert.equal(linuxFromCase, '/mnt/show/project/shot/plates/plate.exr');

  // Windows UNC Path to Linux NFS
  const winUNC = '\\\\studio-storage\\projects\\vfx_show\\shot010\\render.exr';
  const linuxFromUNC = tokens.mapPath(winUNC, 'linux');
  assert.equal(linuxFromUNC, '/mnt/storage/projects/vfx_show/shot010/render.exr');

  // Round-trip mapping: Linux NFS back to Windows Drive
  const roundTripWinDrive = tokens.mapPath('/mnt/show/project/shot/comp/beauty.1001.exr', 'windows');
  assert.equal(roundTripWinDrive, 'Z:\\show\\project\\shot\\comp\\beauty.1001.exr');

  // Round-trip mapping: Linux NFS back to Windows UNC
  const roundTripUNC = tokens.mapPath('/mnt/storage/projects/vfx_show/shot010/render.exr', 'windows');
  assert.equal(roundTripUNC, '\\\\studio-storage\\projects\\vfx_show\\shot010\\render.exr');

  // Relative paths remain relative with normalized slashes
  assert.equal(tokens.mapPath('../footage/plate.0101.exr', 'linux'), '../footage/plate.0101.exr');
  assert.equal(tokens.mapPath('../footage/plate.0101.exr', 'windows'), '..\\footage\\plate.0101.exr');

  // Unmapped path in non-strict returns normalized path
  assert.equal(tokens.mapPath('/unmapped/local/scratch/test.exr', 'linux'), '/unmapped/local/scratch/test.exr');

  // Unmapped path in strict throws clear error
  assert.throws(() => {
    tokens.mapPath('/unmapped/local/scratch/test.exr', 'windows', { strict: true });
  }, /UnmappedPathError: Path "\/unmapped\/local\/scratch\/test.exr" could not be mapped/);

  console.log('  ✅ 6. Cross-platform path mapping (Drive, UNC <-> NFS, round-trip) passed');
}

// 7. Frame Sequence Resolution (resolveFrameSequence)
{
  const tokens = new PipelineTokens({
    tokens: {
      SHOT: 'sq01_sh010',
      VERSION: 'v002'
    }
  });

  const tpl = '/renders/${SHOT}_${VERSION}.####.exr';
  const frameList = [1001, 1002, 1003, 1004];
  const resolvedSeq = tokens.resolveFrameSequence(tpl, frameList);

  assert.deepEqual(resolvedSeq, [
    '/renders/sq01_sh010_v002.1001.exr',
    '/renders/sq01_sh010_v002.1002.exr',
    '/renders/sq01_sh010_v002.1003.exr',
    '/renders/sq01_sh010_v002.1004.exr'
  ]);

  console.log('  ✅ 7. Frame sequence resolution (resolveFrameSequence) passed');
}

// 8. Sequence Pattern Detection & Missing Frame Analysis (parseSequencePattern)
{
  const files = [
    '/plates/shot_010.0101.exr',
    '/plates/shot_010.0102.exr',
    '/plates/shot_010.0104.exr', // 0103 is missing
    '/plates/shot_010.0105.exr'
  ];

  const parsed = PipelineTokens.parseSequencePattern(files);
  assert.ok(parsed);
  assert.equal(parsed.pattern, '/plates/shot_010.####.exr');
  assert.equal(parsed.start, 101);
  assert.equal(parsed.end, 105);
  assert.equal(parsed.padding, 4);
  assert.deepEqual(parsed.missing, [103]);
  assert.deepEqual(parsed.frames, [101, 102, 104, 105]);

  console.log('  ✅ 8. Sequence pattern detection and missing frame analysis passed');
}

// 9. Global Pipeline Tokens Singleton Test
{
  assert.ok(globalPipelineTokens instanceof PipelineTokens);
  globalPipelineTokens.setToken('GLOBAL_PROJECT', 'MasterVFX');
  const res = globalPipelineTokens.resolve('/path/${GLOBAL_PROJECT}/shot.exr');
  assert.equal(res, '/path/MasterVFX/shot.exr');
  console.log('  ✅ 9. Global singleton instance passed');
}

console.log('\n🎉 ALL PHASE 6.1 PIPELINE TOKENS TESTS PASSED SUCCESSFULLY (9/9 Checks)!');
