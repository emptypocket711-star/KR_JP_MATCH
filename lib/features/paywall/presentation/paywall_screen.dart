import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/theme/app_theme.dart';
import 'key_provider.dart';

class _KeyPackage {
  final int keys;
  final int priceKrw;
  final String? badge;

  const _KeyPackage(this.keys, this.priceKrw, {this.badge});

  int get pricePerKey => (priceKrw / keys).round();
}

const _packages = [
  _KeyPackage(5, 1100),
  _KeyPackage(12, 2200, badge: '인기'),
  _KeyPackage(30, 4400),
  _KeyPackage(70, 9900, badge: '베스트'),
  _KeyPackage(150, 19800),
];

class PaywallScreen extends ConsumerStatefulWidget {
  const PaywallScreen({super.key});

  @override
  ConsumerState<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends ConsumerState<PaywallScreen> {
  int _selectedIndex = 1;
  bool _isPurchasing = false;
  Timer? _timer;
  Duration _untilMidnight = Duration.zero;

  @override
  void initState() {
    super.initState();
    _startTimer();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _startTimer() {
    _updateUntilMidnight();
    _timer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => _updateUntilMidnight(),
    );
  }

  void _updateUntilMidnight() {
    final now = DateTime.now();
    final midnight = DateTime(now.year, now.month, now.day + 1);
    if (mounted) {
      setState(() => _untilMidnight = midnight.difference(now));
    }
  }

  Future<void> _handlePurchase() async {
    setState(() => _isPurchasing = true);
    await Future.delayed(const Duration(seconds: 1));
    if (!mounted) return;
    setState(() => _isPurchasing = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Google Play 결제 연동 준비 중이에요.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final keyCount = ref.watch(keyCountProvider).maybeWhen(
          data: (value) => value,
          orElse: () => 0,
        );

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.background,
        elevation: 0,
        title: const Text('열쇠 충전',
            style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: AppTheme.textPrimary)),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          // 현재 잔고
          Container(
            padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 24),
            decoration: BoxDecoration(
              gradient: AppTheme.primaryGradient,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              children: [
                const Icon(Icons.key_rounded, color: Colors.white, size: 28),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('보유 열쇠',
                        style: TextStyle(
                            fontSize: 13,
                            color: Colors.white70,
                            fontWeight: FontWeight.w500)),
                    Text('$keyCount개',
                        style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            color: Colors.white)),
                  ],
                ),
                const Spacer(),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('무료 충전까지',
                        style: TextStyle(fontSize: 11, color: Colors.white70)),
                    Text(_formatDuration(_untilMidnight),
                        style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: Colors.white)),
                    const Text('매일 3개 무료',
                        style: TextStyle(fontSize: 11, color: Colors.white70)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Container(
            margin: const EdgeInsets.only(bottom: 16),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Row(
              children: [
                Icon(Icons.chat_bubble_outline,
                    size: 16, color: AppTheme.primary),
                SizedBox(width: 8),
                Text('대화 시작 1회 = 열쇠 1개 소모',
                    style: TextStyle(
                        fontSize: 13,
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.w500)),
              ],
            ),
          ),
          const Text('충전 패키지',
              style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.textPrimary)),
          const SizedBox(height: 12),
          ...List.generate(_packages.length, (i) {
            final pkg = _packages[i];
            final selected = _selectedIndex == i;
            return GestureDetector(
              onTap: () => setState(() => _selectedIndex = i),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                margin: const EdgeInsets.only(bottom: 10),
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                decoration: BoxDecoration(
                  color: selected
                      ? AppTheme.primary.withValues(alpha: 0.08)
                      : AppTheme.cardBg,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: selected ? AppTheme.primary : AppTheme.divider,
                    width: selected ? 2 : 1,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(Icons.key_rounded,
                        size: 22,
                        color: selected
                            ? AppTheme.primary
                            : AppTheme.textSecondary),
                    const SizedBox(width: 12),
                    Text('열쇠 ${pkg.keys}개',
                        style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: selected
                                ? AppTheme.primary
                                : AppTheme.textPrimary)),
                    if (pkg.badge != null) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.primary,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(pkg.badge!,
                            style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: Colors.white)),
                      ),
                    ],
                    const Spacer(),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text('₩${_formatPrice(pkg.priceKrw)}',
                            style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: selected
                                    ? AppTheme.primary
                                    : AppTheme.textPrimary)),
                        Text('개당 ₩${_formatPrice(pkg.pricePerKey)}',
                            style: TextStyle(
                                fontSize: 11,
                                color: selected
                                    ? AppTheme.primary.withValues(alpha: 0.8)
                                    : AppTheme.textSecondary)),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: AppTheme.primaryGradient,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: _isPurchasing ? null : _handlePurchase,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: _isPurchasing
                        ? const Center(
                            child: SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                  color: Colors.white, strokeWidth: 2.5),
                            ),
                          )
                        : Center(
                            child: Text(
                              '열쇠 ${_packages[_selectedIndex].keys}개 충전  ₩${_formatPrice(_packages[_selectedIndex].priceKrw)}',
                              style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                  color: Colors.white),
                            ),
                          ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Center(
            child: Text('Google Play를 통해 안전하게 결제됩니다',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ),
        ],
      ),
    );
  }

  String _formatPrice(int price) {
    return price.toString().replaceAllMapped(
        RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},');
  }

  String _formatDuration(Duration d) {
    final h = d.inHours.toString().padLeft(2, '0');
    final m = (d.inMinutes % 60).toString().padLeft(2, '0');
    final s = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$h:$m:$s';
  }
}
