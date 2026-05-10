import 'package:flutter/material.dart';

class UserNameText extends StatelessWidget {
  final String name;
  final String seed;
  final TextStyle? style;
  final int? maxLines;
  final TextOverflow? overflow;
  final TextAlign? textAlign;

  const UserNameText({
    required this.name,
    required this.seed,
    this.style,
    this.maxLines,
    this.overflow,
    this.textAlign,
    super.key,
  });

  static const _fontFamily = 'MaruBuri';

  @override
  Widget build(BuildContext context) {
    return Text(
      name,
      maxLines: maxLines,
      overflow: overflow,
      textAlign: textAlign,
      style: style?.copyWith(
            fontFamily: _fontFamily,
            fontFamilyFallback: const ['sans-serif', 'serif'],
          ) ??
          const TextStyle(
            fontFamily: _fontFamily,
            fontFamilyFallback: ['sans-serif', 'serif'],
          ),
    );
  }
}
