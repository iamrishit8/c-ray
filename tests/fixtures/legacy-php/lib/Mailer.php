<?php

class Mailer {
    public function send($to, $subject, $body) {
        $ch = curl_init('https://api.mailprovider.example.com/v1/send');
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_POSTFIELDS, array('to' => $to, 'subject' => $subject, 'body' => $body));
        $response = curl_exec($ch);
        curl_close($ch);
        return $response;
    }
}
