import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/app_theme.dart';
import '../i18n/ui_text.dart';

const _tabColors = [
  Color(0xFFE8826A),
  Color(0xFF5B8DEF),
  Color(0xFF4CAF82),
  Color(0xFF9B6FE8),
];

class BottomNavBar extends StatelessWidget {
  final int currentIndex;

  const BottomNavBar({required this.currentIndex, super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        border: const Border(
          top: BorderSide(color: AppTheme.divider, width: 1),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 16,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 62,
          child: Row(
            children: [
              _NavItem(
                icon: Icons.explore_outlined,
                activeIcon: Icons.explore,
                label: context.t('\uBC1C\uACAC', '\u767A\u898B'),
                selected: currentIndex == 0,
                color: _tabColors[0],
                onTap: () => context.go('/discovery'),
              ),
              _NavItem(
                icon: Icons.forum_outlined,
                activeIcon: Icons.forum,
                label:
                    context.t('\uB77C\uC6B4\uC9C0', '\u30E9\u30A6\u30F3\u30B8'),
                selected: currentIndex == 1,
                color: _tabColors[1],
                onTap: () => context.go('/lounge'),
              ),
              _NavItem(
                icon: Icons.chat_bubble_outline,
                activeIcon: Icons.chat_bubble,
                label: context.t('\uCC44\uD305', '\u30C1\u30E3\u30C3\u30C8'),
                selected: currentIndex == 2,
                color: _tabColors[2],
                onTap: () => context.go('/chats'),
              ),
              _NavItem(
                icon: Icons.settings_outlined,
                activeIcon: Icons.settings,
                label: context.t('\uC124\uC815', '\u8A2D\u5B9A'),
                selected: currentIndex == 3,
                color: _tabColors[3],
                onTap: () => context.go('/settings'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool selected;
  final Color color;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.selected,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              decoration: BoxDecoration(
                color: selected
                    ? color.withValues(alpha: 0.12)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Icon(
                selected ? activeIcon : icon,
                color: selected ? color : const Color(0xFFB8ADA6),
                size: 22,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? color : const Color(0xFFB8ADA6),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
