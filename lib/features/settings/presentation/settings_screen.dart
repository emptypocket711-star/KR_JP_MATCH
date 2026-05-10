import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers/font_size_provider.dart';
import '../../../app/theme/app_theme.dart';
import '../../../core/i18n/ui_text.dart';
import '../../../core/widgets/bottom_nav_bar.dart';
import '../../../core/widgets/default_avatar.dart';
import '../../auth/presentation/auth_provider.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  Map<String, dynamic>? _profile;
  bool _notifications = true;
  bool _nightQuiet = false;
  bool _isDeleting = false;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    final doc =
        await FirebaseFirestore.instance.collection('users').doc(uid).get();
    if (!mounted) return;

    final data = doc.data();
    setState(() {
      _profile = data;
      _notifications = data?['notificationsEnabled'] as bool? ?? true;
      _nightQuiet = data?['nightQuietEnabled'] as bool? ?? false;
    });
  }

  Future<void> _updateNotificationSetting(String field, bool value) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    await FirebaseFirestore.instance
        .collection('users')
        .doc(uid)
        .update({field: value});
  }

  Future<void> _updateUiLanguage(String languageCode) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    final userRef = FirebaseFirestore.instance.collection('users').doc(uid);
    if (languageCode == 'auto') {
      await userRef.update({'uiLanguage': FieldValue.delete()});
    } else {
      await userRef.update({'uiLanguage': languageCode});
    }

    if (!mounted) return;
    setState(() {
      _profile = {...?_profile};
      if (languageCode == 'auto') {
        _profile!.remove('uiLanguage');
      } else {
        _profile!['uiLanguage'] = languageCode;
      }
    });
  }

  Future<void> _signOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(context.t(
            '\uB85C\uADF8\uC544\uC6C3', '\u30ED\u30B0\u30A2\u30A6\u30C8')),
        content: Text(context.t(
          '\uC815\uB9D0 \uB85C\uADF8\uC544\uC6C3 \uD558\uC2DC\uACA0\uC5B4\uC694?',
          '\u672C\u5F53\u306B\u30ED\u30B0\u30A2\u30A6\u30C8\u3057\u307E\u3059\u304B?',
        )),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(
                context.t('\uCDE8\uC18C', '\u30AD\u30E3\u30F3\u30BB\u30EB')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              context.t(
                  '\uB85C\uADF8\uC544\uC6C3', '\u30ED\u30B0\u30A2\u30A6\u30C8'),
              style: const TextStyle(color: AppTheme.primary),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    await ref.read(authRepositoryProvider).signOut();
    if (mounted) context.go('/login');
  }

  Future<void> _deleteAccount() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(context.t('\uD68C\uC6D0 \uD0C8\uD1F4', '\u9000\u4F1A')),
        content: Text(context.t(
          '\uD0C8\uD1F4\uD558\uBA74 \uD504\uB85C\uD544, \uCC44\uD305 \uAE30\uB85D, \uB9E4\uCE6D \uC815\uBCF4\uAC00 \uBAA8\uB450 \uC0AD\uC81C\uB418\uBA70 \uBCF5\uAD6C\uD560 \uC218 \uC5C6\uC5B4\uC694.\n\n\uC815\uB9D0 \uD0C8\uD1F4\uD558\uC2DC\uACA0\uC5B4\uC694?',
          '\u9000\u4F1A\u3059\u308B\u3068\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u3001\u30C1\u30E3\u30C3\u30C8\u5C65\u6B74\u3001\u30DE\u30C3\u30C1\u60C5\u5831\u304C\u3059\u3079\u3066\u524A\u9664\u3055\u308C\u3001\u5FA9\u5143\u3067\u304D\u307E\u305B\u3093\u3002\n\n\u672C\u5F53\u306B\u9000\u4F1A\u3057\u307E\u3059\u304B?',
        )),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(
                context.t('\uCDE8\uC18C', '\u30AD\u30E3\u30F3\u30BB\u30EB')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              context.t('\uD0C8\uD1F4', '\u9000\u4F1A'),
              style: const TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _isDeleting = true);

    try {
      await FirebaseFunctions.instance.httpsCallable('deleteAccount').call();
      await ref.read(authRepositoryProvider).signOut();
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) return;
      setState(() => _isDeleting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(context.t(
            '\uD0C8\uD1F4 \uC2E4\uD328: ${e.message ?? e.code}',
            '\u9000\u4F1A\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${e.message ?? e.code}',
          )),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _isDeleting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(context.t(
            '\uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC5B4\uC694. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.',
            '\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002\u3057\u3070\u3089\u304F\u3057\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002',
          )),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    final displayName =
        _profile?['displayName'] as String? ?? user?.displayName ?? 'User';
    final birthYear = _profile?['birthYear'] as int? ?? 2000;
    final age = DateTime.now().year - birthYear;
    final city = _profile?['city'] as String? ?? '';
    final bio = _profile?['bio'] as String? ?? '';
    final nationality = _profile?['nationality'] as String? ?? 'KR';
    final gender = _profile?['gender'] as String? ?? 'female';
    final photoUrls = (_profile?['photoUrls'] as List?)?.cast<String>() ?? [];
    final photoUrl = photoUrls.isNotEmpty ? photoUrls.first : '';
    final likeCount = (_profile?['likeCount'] as num?)?.toInt() ?? 0;
    final uiLanguage = _profile?['uiLanguage'] as String?;

    return Scaffold(
      backgroundColor: AppTheme.background,
      body: Column(
        children: [
          const _SettingsImageHeader(),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                _ProfileCard(
                  displayName: displayName,
                  age: age,
                  city: city,
                  bio: bio,
                  nationality: nationality,
                  gender: gender,
                  photoUrl: photoUrl,
                  likeCount: likeCount,
                  onEdit: () => context.push('/profile/edit'),
                ),
                const SizedBox(height: 12),
                _SectionHeader(context.t(
                  '\uD654\uBA74 \uC124\uC815',
                  '\u8868\u793A\u8A2D\u5B9A',
                )),
                const _FontSizeTile(),
                _LanguageTile(
                  current: uiLanguage,
                  onChanged: _updateUiLanguage,
                ),
                const SizedBox(height: 12),
                _SectionHeader(context.t(
                  '\uC54C\uB9BC \uC124\uC815',
                  '\u901A\u77E5\u8A2D\u5B9A',
                )),
                _ToggleTile(
                  icon: Icons.notifications_outlined,
                  label: context.t(
                    '\uC54C\uB9BC \uD5C8\uC6A9',
                    '\u901A\u77E5\u3092\u8A31\u53EF',
                  ),
                  value: _notifications,
                  onChanged: (v) {
                    setState(() => _notifications = v);
                    _updateNotificationSetting('notificationsEnabled', v);
                  },
                ),
                _ToggleTile(
                  icon: Icons.bedtime_outlined,
                  label: context.t(
                    '\uC57C\uAC04 \uC54C\uB9BC \uBB34\uC74C',
                    '\u591C\u9593\u901A\u77E5\u3092\u30DF\u30E5\u30FC\u30C8',
                  ),
                  subtitle: '22:00 ~ 08:00',
                  value: _nightQuiet,
                  onChanged: (v) {
                    setState(() => _nightQuiet = v);
                    _updateNotificationSetting('nightQuietEnabled', v);
                  },
                ),
                _ArrowTile(
                  icon: Icons.block_outlined,
                  label: context.t(
                    '\uCC28\uB2E8 \uBAA9\uB85D',
                    '\u30D6\u30ED\u30C3\u30AF\u30EA\u30B9\u30C8',
                  ),
                  onTap: () => context.push('/settings/blocks'),
                ),
                const SizedBox(height: 12),
                _SectionHeader(context.t(
                  '\uBC95\uC801 / \uC815\uBCF4',
                  '\u6CD5\u52D9 / \u60C5\u5831',
                )),
                _ArrowTile(
                  icon: Icons.description_outlined,
                  label: context.t(
                    '\uC774\uC6A9\uC57D\uAD00',
                    '\u5229\u7528\u898F\u7D04',
                  ),
                  onTap: () {},
                ),
                _ArrowTile(
                  icon: Icons.privacy_tip_outlined,
                  label: context.t(
                    '\uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68',
                    '\u30D7\u30E9\u30A4\u30D0\u30B7\u30FC\u30DD\u30EA\u30B7\u30FC',
                  ),
                  onTap: () {},
                ),
                _InfoTile(
                  icon: Icons.info_outline,
                  label: context.t(
                    '\uC571 \uBC84\uC804',
                    '\u30A2\u30D7\u30EA\u30D0\u30FC\u30B8\u30E7\u30F3',
                  ),
                  value: '1.0.0 (1)',
                ),
                const SizedBox(height: 24),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _isDeleting ? null : _signOut,
                          icon: const Icon(Icons.logout_rounded, size: 16),
                          label: Text(context.t(
                            '\uB85C\uADF8\uC544\uC6C3',
                            '\u30ED\u30B0\u30A2\u30A6\u30C8',
                          )),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppTheme.textSecondary,
                            side: const BorderSide(color: AppTheme.divider),
                            padding: const EdgeInsets.symmetric(vertical: 13),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      TextButton(
                        onPressed: _isDeleting ? null : _deleteAccount,
                        child: _isDeleting
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.red,
                                ),
                              )
                            : Text(
                                context.t(
                                  '\uD68C\uC6D0 \uD0C8\uD1F4',
                                  '\u9000\u4F1A',
                                ),
                                style: const TextStyle(
                                  color: Colors.red,
                                  fontSize: 13,
                                ),
                              ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 32),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: const BottomNavBar(currentIndex: 3),
    );
  }
}

class _SettingsImageHeader extends StatelessWidget {
  const _SettingsImageHeader();

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 2172 / 724,
      child: Image.asset(
        context.headerAsset('settings'),
        width: double.infinity,
        fit: BoxFit.contain,
      ),
    );
  }
}

class _ProfileCard extends StatelessWidget {
  final String displayName;
  final int age;
  final String city;
  final String bio;
  final String nationality;
  final String gender;
  final String photoUrl;
  final int likeCount;
  final VoidCallback onEdit;

  const _ProfileCard({
    required this.displayName,
    required this.age,
    required this.city,
    required this.bio,
    required this.nationality,
    required this.gender,
    required this.photoUrl,
    required this.likeCount,
    required this.onEdit,
  });

  @override
  Widget build(BuildContext context) {
    final flag = nationality == 'KR' ? 'KR' : 'JP';
    final ageText = context.t('\uC138', '\u6B73');
    final cityText = city.isNotEmpty ? ' · $city' : '';

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(36),
                child: SizedBox(
                  width: 72,
                  height: 72,
                  child: photoUrl.isNotEmpty
                      ? CachedNetworkImage(
                          imageUrl: photoUrl,
                          fit: BoxFit.cover,
                        )
                      : DefaultAvatar(
                          nationality: nationality,
                          gender: gender,
                          fit: BoxFit.cover,
                        ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w800,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          flag,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$age$ageText$cityText',
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                    if (bio.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        bio,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              OutlinedButton(
                onPressed: onEdit,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.primary,
                  side: const BorderSide(color: AppTheme.primary),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Text(
                  context.t(
                    '\uD504\uB85C\uD544 \uD3B8\uC9D1',
                    '\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u7DE8\u96C6',
                  ),
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Divider(height: 1, color: AppTheme.divider),
          const SizedBox(height: 12),
          Row(
            children: [
              _StatItem(
                label: context.t(
                  '\uBC1B\uC740 \uD558\uD2B8',
                  '\u3082\u3089\u3063\u305F\u30CF\u30FC\u30C8',
                ),
                value: '$likeCount',
              ),
              const _StatDivider(),
              _StatItem(
                label: context.t(
                  '\uBCF4\uC720 \uD3EC\uC778\uD2B8',
                  '\u6240\u6709\u30DD\u30A4\u30F3\u30C8',
                ),
                value: '0 P',
              ),
              const _StatDivider(),
              GestureDetector(
                onTap: () {},
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [AppTheme.primary, AppTheme.gradientEnd],
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    context.t(
                      '\uCDA9\uC804\uD558\uAE30',
                      '\u30C1\u30E3\u30FC\u30B8',
                    ),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final String label;
  final String value;

  const _StatItem({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 11,
              color: AppTheme.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatDivider extends StatelessWidget {
  const _StatDivider();

  @override
  Widget build(BuildContext context) {
    return Container(width: 1, height: 28, color: AppTheme.divider);
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;

  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: AppTheme.textSecondary,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

class _ToggleTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _ToggleTile({
    required this.icon,
    required this.label,
    this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: ListTile(
        dense: true,
        leading: Icon(icon, color: AppTheme.primary, size: 20),
        title: Text(
          label,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        subtitle: subtitle != null
            ? Text(
                subtitle!,
                style: const TextStyle(
                  fontSize: 11,
                  color: AppTheme.textSecondary,
                ),
              )
            : null,
        trailing: Switch(
          value: value,
          onChanged: onChanged,
          activeThumbColor: AppTheme.primary,
          activeTrackColor: AppTheme.primaryLight,
          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
      ),
    );
  }
}

class _FontSizeTile extends ConsumerWidget {
  const _FontSizeTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(fontSizeProvider);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: ListTile(
        dense: true,
        leading:
            const Icon(Icons.format_size, color: AppTheme.primary, size: 20),
        title: Text(
          context.t(
              '\uD3F0\uD2B8 \uD06C\uAE30', '\u6587\u5B57\u30B5\u30A4\u30BA'),
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: FontSizePreset.values.map((preset) {
            final isSelected = current == preset;
            return GestureDetector(
              onTap: () => ref.read(fontSizeProvider.notifier).set(preset),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                margin: const EdgeInsets.only(left: 6),
                padding: const EdgeInsets.symmetric(
                  horizontal: 11,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: isSelected ? AppTheme.primary : AppTheme.surface,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  preset.label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: isSelected ? Colors.white : AppTheme.textSecondary,
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }
}

class _LanguageTile extends StatelessWidget {
  final String? current;
  final ValueChanged<String> onChanged;

  const _LanguageTile({
    required this.current,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: ListTile(
        dense: true,
        onTap: () => _showLanguageSheet(context),
        leading: const Icon(Icons.language, color: AppTheme.primary, size: 20),
        title: Text(
          context.t('UI \uC5B8\uC5B4', 'UI\u8A00\u8A9E'),
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _languageLabel(context, current),
              style: const TextStyle(
                fontSize: 13,
                color: AppTheme.textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 4),
            const Icon(
              Icons.chevron_right,
              size: 18,
              color: AppTheme.textSecondary,
            ),
          ],
        ),
      ),
    );
  }

  void _showLanguageSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.cardBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTheme.divider,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
                const SizedBox(height: 14),
                _LanguageOption(
                  label: context.t('\uC790\uB3D9', '\u81EA\u52D5'),
                  subtitle: context.t(
                    '\uAD6D\uC801\uC5D0 \uB9DE\uCDB0 \uC790\uB3D9 \uC120\uD0DD',
                    '\u56FD\u7C4D\u306B\u5408\u308F\u305B\u3066\u81EA\u52D5\u9078\u629E',
                  ),
                  selected: current != 'ko' && current != 'ja',
                  onTap: () {
                    Navigator.pop(sheetContext);
                    onChanged('auto');
                  },
                ),
                _LanguageOption(
                  label: context.t('\uD55C\uAD6D\uC5B4', '\u97D3\u56FD\u8A9E'),
                  selected: current == 'ko',
                  onTap: () {
                    Navigator.pop(sheetContext);
                    onChanged('ko');
                  },
                ),
                _LanguageOption(
                  label: context.t('\uC77C\uBCF8\uC5B4', '\u65E5\u672C\u8A9E'),
                  selected: current == 'ja',
                  onTap: () {
                    Navigator.pop(sheetContext);
                    onChanged('ja');
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  String _languageLabel(BuildContext context, String? value) {
    return switch (value) {
      'ko' => context.t('\uD55C\uAD6D\uC5B4', '\u97D3\u56FD\u8A9E'),
      'ja' => context.t('\uC77C\uBCF8\uC5B4', '\u65E5\u672C\u8A9E'),
      _ => context.t('\uC790\uB3D9', '\u81EA\u52D5'),
    };
  }
}

class _LanguageOption extends StatelessWidget {
  final String label;
  final String? subtitle;
  final bool selected;
  final VoidCallback onTap;

  const _LanguageOption({
    required this.label,
    this.subtitle,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 4),
      title: Text(
        label,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w700,
          color: AppTheme.textPrimary,
        ),
      ),
      subtitle: subtitle == null
          ? null
          : Text(
              subtitle!,
              style: const TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondary,
              ),
            ),
      trailing: selected
          ? const Icon(Icons.check_circle, color: AppTheme.primary, size: 22)
          : const Icon(Icons.circle_outlined,
              color: AppTheme.divider, size: 22),
    );
  }
}

class _ArrowTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _ArrowTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: ListTile(
        dense: true,
        onTap: onTap,
        leading: Icon(icon, color: AppTheme.primary, size: 20),
        title: Text(
          label,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        trailing: const Icon(
          Icons.chevron_right,
          size: 18,
          color: AppTheme.textSecondary,
        ),
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: ListTile(
        dense: true,
        leading: Icon(icon, color: AppTheme.textSecondary, size: 20),
        title: Text(
          label,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        trailing: Text(
          value,
          style: const TextStyle(
            fontSize: 13,
            color: AppTheme.textSecondary,
          ),
        ),
      ),
    );
  }
}
