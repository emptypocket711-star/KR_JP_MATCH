import 'package:flutter/material.dart';

class NationalityBadge extends StatelessWidget {
  final String nationality;
  final double fontSize;
  final EdgeInsetsGeometry padding;

  const NationalityBadge({
    required this.nationality,
    this.fontSize = 10,
    this.padding = const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    final isKr = nationality == 'KR';
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: isKr ? const Color(0xFFEFF4FF) : const Color(0xFFFFF0EE),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        isKr ? 'KR' : 'JP',
        style: TextStyle(
          fontSize: fontSize,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.04,
          color: isKr ? const Color(0xFF3D6FD4) : const Color(0xFFC44D3A),
        ),
      ),
    );
  }
}

String nationalityFlag(String nationality) {
  switch (nationality) {
    case 'KR':
      return '🇰🇷';
    case 'JP':
      return '🇯🇵';
    default:
      return '';
  }
}
