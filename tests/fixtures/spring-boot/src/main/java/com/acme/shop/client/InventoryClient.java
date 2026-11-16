package com.acme.shop.client;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class InventoryClient {
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${inventory.url}")
    private String baseUrl;

    public boolean isAvailable(String sku, int quantity) {
        Boolean available = restTemplate.getForObject(baseUrl + "/availability/" + sku + "?qty=" + quantity, Boolean.class);
        return Boolean.TRUE.equals(available);
    }
}
